// 文件名: ApiServer.test.ts

import { ApiServer } from '../src/network/ApiServer';
import { CommitteeNode } from '../src/core/CommitteeNode';
import { QoSProof, TaskProcessingState, TaskStatus } from '../src/models/types';
import request from 'supertest';
import express from 'express';

// 模拟 CommitteeNode
jest.mock('../src/core/CommitteeNode');

// 模拟 logger
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ApiServer 测试', () => {
  let apiServer: ApiServer;
  let mockCommitteeNode: jest.Mocked<CommitteeNode>;
  const testPort = 8888;

  // 有效的示例 QoS 证明
  const validProof: QoSProof = {
    taskId: 'test-task-123',
    verifierId: 'test-verifier-456',
    timestamp: Date.now(),
    mediaSpecs: {
      codec: 'H.264',
      width: 1920,
      height: 1080,
      bitrate: 5000,
      hasAudio: true,
    },
    videoQualityData: {
      overallScore: 85,
      gopScores: {
        '1000': '87.5',
        '2000': '83.2',
      },
    },
    audioQualityData: {
      overallScore: 92.5,
    },
    syncQualityData: {
      offset: 0.02,
      score: 98.5,
    },
    signature: 'valid-test-signature',
  };

  // 示例任务状态
  const testTaskStatus: TaskStatus = {
    taskId: 'test-task-123',
    state: TaskProcessingState.Validating,
    proofCount: 2,
    verifierIds: ['test-verifier-456', 'test-verifier-789'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // 清除所有模拟的实现
    jest.clearAllMocks();

    // 创建 CommitteeNode 模拟
    mockCommitteeNode = new CommitteeNode('node1', 9000, true, [], 4) as jest.Mocked<CommitteeNode>;

    // 模拟 CommitteeNode 方法
    mockCommitteeNode.getStatus.mockReturnValue({
      nodeId: 'node1',
      isLeader: true,
      pbftState: 'idle',
      connections: { total: 2, connected: 2, peers: ['node2', 'node3'] },
    });

    mockCommitteeNode.handleQoSProof.mockImplementation(() => {});
    mockCommitteeNode.handleSupplementaryProof.mockImplementation(() => {});
    mockCommitteeNode.getTaskStatus.mockImplementation(taskId => {
      if (taskId === 'test-task-123') {
        return testTaskStatus;
      }
      return null;
    });

    // 创建 ApiServer 实例
    apiServer = new ApiServer(testPort, mockCommitteeNode);

    // 开始服务器
    return apiServer.start();
  });

  afterEach(() => {
    // 关闭服务器
    return apiServer.stop();
  });

  // 辅助函数：获取 Express 实例
  function getExpressApp(): express.Application {
    return (apiServer as any).app;
  }

  describe('基础接口测试', () => {
    test('健康检查接口应返回正常状态', async () => {
      const response = await request(getExpressApp()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });

    test('状态接口应返回节点状态', async () => {
      const response = await request(getExpressApp()).get('/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('nodeId', 'node1');
      expect(response.body).toHaveProperty('isLeader', true);
      expect(mockCommitteeNode.getStatus).toHaveBeenCalled();
    });
  });

  describe('QoS证明提交测试', () => {
    test('提交有效的QoS证明应成功', async () => {
      const response = await request(getExpressApp()).post('/proof').send(validProof);

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('taskId', validProof.taskId);
      expect(mockCommitteeNode.handleQoSProof).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: validProof.taskId,
          verifierId: validProof.verifierId,
        })
      );
    });

    test('提交缺少必要字段的QoS证明应失败', async () => {
      // 创建一个新对象而不是修改原有对象
      const invalidProof = {
        ...validProof,
        taskId: undefined, // 设为 undefined 而不是删除
      } as any; // 使用 as any 绕过 TypeScript 类型检查

      const response = await request(getExpressApp()).post('/proof').send(invalidProof);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockCommitteeNode.handleQoSProof).not.toHaveBeenCalled();
    });

    test('提交缺少视频质量数据的QoS证明应失败', async () => {
      const invalidProof = {
        ...validProof,
        videoQualityData: {
          overallScore: undefined,
          gopScores: undefined,
        },
      } as any;
      delete invalidProof.videoQualityData;

      const response = await request(getExpressApp()).post('/proof').send(invalidProof);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockCommitteeNode.handleQoSProof).not.toHaveBeenCalled();
    });
  });

  describe('批量QoS证明提交测试', () => {
    test('批量提交有效的QoS证明应成功', async () => {
      const proof1 = { ...validProof, taskId: 'batch-task-1' };
      const proof2 = { ...validProof, taskId: 'batch-task-2' };

      const response = await request(getExpressApp()).post('/proofs/batch').send([proof1, proof2]);

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('results');
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0]).toHaveProperty('status', 'accepted');
      expect(response.body.results[1]).toHaveProperty('status', 'accepted');
      expect(mockCommitteeNode.handleQoSProof).toHaveBeenCalledTimes(2);
    });

    test('批量提交混合有效和无效的QoS证明应返回部分成功', async () => {
      const validProof1 = { ...validProof, taskId: 'batch-task-1' };
      const invalidProof = { taskId: 'batch-task-2' }; // 缺少必要字段

      const response = await request(getExpressApp())
        .post('/proofs/batch')
        .send([validProof1, invalidProof]);

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('results');
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0]).toHaveProperty('status', 'accepted');
      expect(response.body.results[1]).toHaveProperty('status', 'rejected');
      expect(mockCommitteeNode.handleQoSProof).toHaveBeenCalledTimes(1);
    });

    test('提交空数组应返回错误', async () => {
      const response = await request(getExpressApp()).post('/proofs/batch').send([]);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockCommitteeNode.handleQoSProof).not.toHaveBeenCalled();
    });
  });

  describe('补充验证测试', () => {
    test('提交有效的补充QoS证明应成功', async () => {
      const response = await request(getExpressApp())
        .post('/proof/test-task-123/supplementary')
        .send(validProof);

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('taskId', 'test-task-123');
      expect(mockCommitteeNode.handleSupplementaryProof).toHaveBeenCalledWith(
        'test-task-123',
        expect.objectContaining({
          taskId: 'test-task-123', // 应该被覆盖为路径参数中的taskId
          verifierId: validProof.verifierId,
        })
      );
    });

    test('提交无效的补充QoS证明应失败', async () => {
      const invalidProof = { ...validProof, verifierId: undefined } as any;
      // delete invalidProof.verifierId;

      const response = await request(getExpressApp())
        .post('/proof/test-task-123/supplementary')
        .send(invalidProof);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockCommitteeNode.handleSupplementaryProof).not.toHaveBeenCalled();
    });
  });

  describe('任务状态查询测试', () => {
    test('查询存在的任务状态应返回正确信息', async () => {
      const response = await request(getExpressApp()).get('/proof/test-task-123/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('taskId', 'test-task-123');
      expect(response.body).toHaveProperty('state');
      expect(response.body).toHaveProperty('proofCount', 2);
      expect(mockCommitteeNode.getTaskStatus).toHaveBeenCalledWith('test-task-123');
    });

    test('查询不存在的任务状态应返回404', async () => {
      const response = await request(getExpressApp()).get('/proof/nonexistent-task/status');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(mockCommitteeNode.getTaskStatus).toHaveBeenCalledWith('nonexistent-task');
    });
  });

  // 错误处理测试
  describe('错误处理测试', () => {
    test('当CommitteeNode抛出异常时应返回500错误', async () => {
      // 模拟handleQoSProof抛出异常
      mockCommitteeNode.handleQoSProof.mockImplementation(() => {
        throw new Error('模拟处理错误');
      });

      const response = await request(getExpressApp()).post('/proof').send(validProof);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });
});
