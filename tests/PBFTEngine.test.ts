// 文件名: PBFTEngine.test.ts

import { PBFTEngine } from '../src/core/PBFTEngine';
import {
  MessageType,
  ConsensusState,
  PBFTMessage,
  QoSProof,
  ConsensusType,
} from '../src/models/types';
import { calculateHash, sign } from '../src/utils/crypto';

// 模拟依赖
jest.mock('../src/utils/logger', () => ({
  logger: {
    // info: jest.fn(),
    // warn: jest.fn(),
    // error: jest.fn(),
    // debug: jest.fn(),
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.warn(`[WARN] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  },
}));

jest.mock('../src/utils/crypto', () => ({
  calculateHash: jest.fn(data => 'mock-hash-' + JSON.stringify(data).length),
  sign: jest.fn(() => 'mock-signature'),
}));

describe('PBFTEngine', () => {
  let engine: PBFTEngine;
  let consensusReachedCallback: jest.Mock;

  beforeEach(() => {
    // 重置所有模拟
    jest.clearAllMocks();

    // 创建一个模拟的共识回调函数
    consensusReachedCallback = jest.fn();

    // 创建一个新的PBFT引擎实例
    engine = new PBFTEngine(
      'node1', // 节点ID
      true, // 是否为Leader
      4, // 总节点数
      consensusReachedCallback, // 共识回调
      'test-private-key' // 私钥
    );
  });

  //   describe('基础功能测试', () => {
  //     test('初始状态应为Idle', () => {
  //       expect(engine.getState()).toBe(ConsensusState.Idle);
  //     });

  //     test('视图编号初始为0', () => {
  //       expect(engine.getCurrentViewNumber()).toBe(0);
  //     });

  //     test('序列号应自增', () => {
  //       expect(engine.getNextSequenceNumber()).toBe(1);
  //       expect(engine.getNextSequenceNumber()).toBe(2);
  //     });
  //   });

  //   describe('Leader启动共识测试', () => {
  //     test('Leader应能成功启动共识并生成PrePrepare消息', () => {
  //       // 准备一个测试用的QoS证明
  //       const proof: QoSProof = {
  //         taskId: 'task-123',
  //         verifierId: 'verifier-1',
  //         timestamp: Date.now(),
  //         videoQualityData: 90,
  //         audioQualityData: 4.2,
  //         syncQualityData: 0,
  //       };

  //       // 启动共识
  //       const message = engine.startConsensus(proof, ConsensusType.Normal);

  //       // 验证返回的PrePrepare消息
  //       expect(message).not.toBeNull();
  //       expect(message?.type).toBe(MessageType.PrePrepare);
  //       expect(message?.consensusType).toBe(ConsensusType.Normal);
  //       expect(message?.viewNumber).toBe(0);
  //       expect(message?.sequenceNumber).toBe(1);
  //       expect(message?.nodeId).toBe('node1');
  //       expect(message?.data).toEqual(proof);
  //       expect(message?.signature).toBeDefined();

  //       // 验证引擎状态已改变
  //       expect(engine.getState()).toBe(ConsensusState.PrePrepared);
  //     });

  //     test('非Leader尝试启动共识应返回null', () => {
  //       // 创建一个非Leader节点的引擎
  //       const followerEngine = new PBFTEngine(
  //         'node2', // 节点ID
  //         false, // 非Leader
  //         4, // 总节点数
  //         jest.fn(), // 共识回调
  //         'test-private-key' // 私钥
  //       );

  //       // 准备一个测试用的QoS证明
  //       const proof: QoSProof = {
  //         taskId: 'task-123',
  //         verifierId: 'verifier-1',
  //         timestamp: Date.now(),
  //         videoQualityData: 90,
  //         audioQualityData: 4.2,
  //         syncQualityData: 0,
  //       };

  //       // 尝试启动共识
  //       const message = followerEngine.startConsensus(proof, ConsensusType.Normal);

  //       // 验证返回null
  //       expect(message).toBeNull();

  //       // 验证引擎状态未改变
  //       expect(followerEngine.getState()).toBe(ConsensusState.Idle);
  //     });
  //   });

  //   describe('消息处理测试', () => {
  //     test('Follower应能处理PrePrepare消息并生成Prepare消息', () => {
  //       // 创建一个非Leader节点的引擎
  //       const followerEngine = new PBFTEngine(
  //         'node2', // 节点ID
  //         false, // 非Leader
  //         4, // 总节点数
  //         jest.fn(), // 共识回调
  //         'test-private-key' // 私钥
  //       );

  //       // 准备一个测试用的QoS证明
  //       const proof: QoSProof = {
  //         taskId: 'task-123',
  //         verifierId: 'verifier-1',
  //         timestamp: Date.now(),
  //         videoQualityData: 90,
  //         audioQualityData: 4.2,
  //         syncQualityData: 0,
  //       };

  //       // 构造一个PrePrepare消息
  //       const prePrepareMsg: PBFTMessage = {
  //         type: MessageType.PrePrepare,
  //         consensusType: ConsensusType.Normal,
  //         viewNumber: 0,
  //         sequenceNumber: 1,
  //         nodeId: 'node1',
  //         data: proof,
  //         digest: calculateHash(proof),
  //         signature: 'leader-signature',
  //       };

  //       // 处理PrePrepare消息
  //       const prepareMsg = followerEngine.handlePrePrepare(prePrepareMsg);

  //       // 验证返回的Prepare消息
  //       expect(prepareMsg).not.toBeNull();
  //       expect(prepareMsg?.type).toBe(MessageType.Prepare);
  //       expect(prepareMsg?.consensusType).toBe(ConsensusType.Normal);
  //       expect(prepareMsg?.viewNumber).toBe(0);
  //       expect(prepareMsg?.sequenceNumber).toBe(1);
  //       expect(prepareMsg?.nodeId).toBe('node2');
  //       expect(prepareMsg?.digest).toBe(prePrepareMsg.digest);

  //       // 验证引擎状态已改变
  //       expect(followerEngine.getState()).toBe(ConsensusState.PrePrepared);
  //     });

  //     test('应能处理Prepare消息并生成Commit消息', () => {
  //       // 准备测试环境：先处理PrePrepare消息使引擎进入PrePrepared状态
  //       const proof: QoSProof = {
  //         taskId: 'task-123',
  //         verifierId: 'verifier-1',
  //         timestamp: Date.now(),
  //         videoQualityData: 90,
  //         audioQualityData: 4.2,
  //         syncQualityData: 0,
  //       };

  //       // Leader启动共识
  //       engine.startConsensus(proof, ConsensusType.Normal);

  //       // 创建足够数量的Prepare消息以达到阈值
  //       const prepareMsg1: PBFTMessage = {
  //         type: MessageType.Prepare,
  //         consensusType: ConsensusType.Normal,
  //         viewNumber: 0,
  //         sequenceNumber: 1,
  //         nodeId: 'node2',
  //         digest: calculateHash(proof),
  //         signature: 'node2-signature',
  //       };

  //       const prepareMsg2: PBFTMessage = {
  //         ...prepareMsg1,
  //         nodeId: 'node3',
  //         signature: 'node3-signature',
  //       };

  //       const prepareMsg3: PBFTMessage = {
  //         ...prepareMsg2,
  //         nodeId: 'node4',
  //         signature: 'node4-signature',
  //       };

  //       // 处理第一个Prepare消息
  //       let result = engine.handlePrepare(prepareMsg1);
  //       expect(result).toBeNull(); // 未达到阈值，返回null

  //       // 处理第二个Prepare消息，还没达到阈值
  //       result = engine.handlePrepare(prepareMsg2);

  //       // 处理第三个Prepare消息，还没达到阈值
  //       result = engine.handlePrepare(prepareMsg3);

  //       // 验证返回的Commit消息
  //       expect(result).not.toBeNull();
  //       expect(result?.type).toBe(MessageType.Commit);
  //       expect(result?.viewNumber).toBe(0);
  //       expect(result?.sequenceNumber).toBe(1);

  //       // 验证引擎状态已改变
  //       expect(engine.getState()).toBe(ConsensusState.Prepared);
  //     });

  //     test('应能处理Commit消息并触发共识回调', () => {
  //       // 准备测试环境：使引擎进入Prepared状态
  //       const proof: QoSProof = {
  //         taskId: 'task-123',
  //         verifierId: 'verifier-1',
  //         timestamp: Date.now(),
  //         videoQualityData: 90,
  //         audioQualityData: 4.2,
  //         syncQualityData: 0,
  //       };

  //       // Leader启动共识
  //       engine.startConsensus(proof, ConsensusType.Normal);

  //       // 通过处理足够的Prepare消息使引擎进入Prepared状态
  //       const prepareMsg1: PBFTMessage = {
  //         type: MessageType.Prepare,
  //         consensusType: ConsensusType.Normal,
  //         viewNumber: 0,
  //         sequenceNumber: 1,
  //         nodeId: 'node2',
  //         digest: calculateHash(proof),
  //         signature: 'node2-signature',
  //       };

  //       const prepareMsg2: PBFTMessage = {
  //         ...prepareMsg1,
  //         nodeId: 'node3',
  //         signature: 'node3-signature',
  //       };

  //       const prepareMsg3: PBFTMessage = {
  //         ...prepareMsg1,
  //         nodeId: 'node4',
  //         signature: 'node4-signature',
  //       };

  //       // 处理Prepare消息使状态变为Prepared
  //       engine.handlePrepare(prepareMsg1);
  //       engine.handlePrepare(prepareMsg2);
  //       engine.handlePrepare(prepareMsg3);

  //       // 创建足够数量的Commit消息以达到阈值
  //       const commitMsg1: PBFTMessage = {
  //         type: MessageType.Commit,
  //         consensusType: ConsensusType.Normal,
  //         viewNumber: 0,
  //         sequenceNumber: 1,
  //         nodeId: 'node2',
  //         digest: calculateHash(proof),
  //         signature: 'node2-signature',
  //       };

  //       const commitMsg2: PBFTMessage = {
  //         ...commitMsg1,
  //         nodeId: 'node3',
  //         signature: 'node3-signature',
  //       };

  //       const commitMsg3: PBFTMessage = {
  //         ...commitMsg2,
  //         nodeId: 'node4',
  //         signature: 'node4-signature',
  //       };

  //       // 处理Commit消息
  //       engine.handleCommit(commitMsg1);
  //       engine.handleCommit(commitMsg2);
  //       engine.handleCommit(commitMsg3);

  //       // 验证共识回调被调用
  //       expect(consensusReachedCallback).toHaveBeenCalledWith(proof);

  //       // 验证引擎状态已重置为Idle
  //       expect(engine.getState()).toBe(ConsensusState.Idle);
  //     });
  //   });

  describe('多节点共识场景', () => {
    // 集成测试示例
    test('多节点PBFT共识流程', () => {
      // 创建多个节点引擎
      const node1 = new PBFTEngine('node1', true, 4, jest.fn()); // Leader
      const node2 = new PBFTEngine('node2', false, 4, jest.fn());
      const node3 = new PBFTEngine('node3', false, 4, jest.fn());
      const node4 = new PBFTEngine('node4', false, 4, jest.fn());

      // 准备数据
      const proof: QoSProof = {
        taskId: 'task-123',
        verifierId: 'verifier-1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 92,
          gopScores: { '0.00': '92' },
        },
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
        signature: 'verifier',
        audioQualityData: 4.2,
        syncQualityData: 0,
      };

      // 模拟网络交互
      // 1. Leader开始共识
      const prePrepareMsg = node1.startConsensus(proof, ConsensusType.Normal);

      // 2. 其他节点接收PrePrepare消息
      const prepareMsg2 = node2.handlePrePrepare(prePrepareMsg!);
      const prepareMsg3 = node3.handlePrePrepare(prePrepareMsg!);
      const prepareMsg4 = node4.handlePrePrepare(prePrepareMsg!);

      // 3. 所有节点接收所有Prepare消息
      const nodes = [node1, node2, node3, node4];
      const prepareMsgs = [prepareMsg2, prepareMsg3, prepareMsg4];

      // 每个节点处理所有Prepare消息
      const commitMsgs: PBFTMessage[] = [];
      for (const node of nodes) {
        for (const msg of prepareMsgs) {
          if (msg !== null) {
            const result = node.handlePrepare(msg);
            if (result) commitMsgs.push(result);
          }
        }
      }

      // 4. 所有节点接收所有Commit消息
      for (const node of nodes) {
        for (const msg of commitMsgs) {
          node.handleCommit(msg);
        }
      }

      // 验证所有节点都达成共识
      for (const node of nodes) {
        const callback = node['onConsensusReached']; // 访问私有回调
        expect(callback).toHaveBeenCalledWith(proof);
        expect(node.getState()).toBe(ConsensusState.Idle);
      }
    });

    test('PBFT共识 - 容错一个节点', () => {
      // 创建多个节点引擎
      const node1 = new PBFTEngine('node1', true, 4, jest.fn()); // Leader
      const node2 = new PBFTEngine('node2', false, 4, jest.fn());
      const node3 = new PBFTEngine('node3', false, 4, jest.fn());
      const node4 = new PBFTEngine('node4', false, 4, jest.fn()); // 这个节点将不响应

      // 准备数据
      const proof: QoSProof = {
        taskId: 'task-123',
        verifierId: 'verifier-1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 92,
          gopScores: { '0.00': '92' },
        },
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
        signature: 'verifier',
        audioQualityData: 4.2,
        syncQualityData: 0,
      };

      // 1. Leader开始共识
      const prePrepareMsg = node1.startConsensus(proof, ConsensusType.Normal);

      // 2. 只有node2和node3接收PrePrepare消息，node4不响应
      const prepareMsg2 = node2.handlePrePrepare(prePrepareMsg!);
      const prepareMsg3 = node3.handlePrePrepare(prePrepareMsg!);
      // node4不处理PrePrepare消息

      // 3. 收集有效的Prepare消息
      const prepareMsgs = [prepareMsg2, prepareMsg3].filter(Boolean);

      // 4. 活跃节点处理所有Prepare消息
      const activeNodes = [node1, node2, node3];
      const commitMsgs: PBFTMessage[] = [];

      for (const node of activeNodes) {
        for (const msg of prepareMsgs) {
          if (msg !== null) {
            const result = node.handlePrepare(msg);
            if (result) commitMsgs.push(result);
          }
        }
      }

      // 5. 活跃节点处理所有Commit消息
      for (const node of activeNodes) {
        for (const msg of commitMsgs) {
          node.handleCommit(msg);
        }
      }

      // 验证所有活跃节点都达成共识
      for (const node of activeNodes) {
        const callback = node['onConsensusReached'] || (node as any).consensusReachedCallback;
        expect(callback).toHaveBeenCalledWith(proof);
        expect(node.getState()).toBe(ConsensusState.Idle);
      }

      // 验证未响应节点没有达成共识
      const inactiveCallback =
        node4['onConsensusReached'] || (node4 as any).consensusReachedCallback;
      expect(inactiveCallback).not.toHaveBeenCalled();
      expect(node4.getState()).toBe(ConsensusState.Idle);
    });

    test('PBFT共识 - 容错两个节点', () => {
      // 创建多个节点引擎
      const node1 = new PBFTEngine('node1', true, 4, jest.fn()); // Leader
      const node2 = new PBFTEngine('node2', false, 4, jest.fn());
      const node3 = new PBFTEngine('node3', false, 4, jest.fn()); // 这个节点将不响应
      const node4 = new PBFTEngine('node4', false, 4, jest.fn()); // 这个节点将不响应

      // 准备数据
      const proof: QoSProof = {
        taskId: 'task-123',
        verifierId: 'verifier-1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 92,
          gopScores: { '0.00': '92' },
        },
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
        signature: 'verifier',
        audioQualityData: 4.2,
        syncQualityData: 0,
      };

      // 1. Leader开始共识
      const prePrepareMsg = node1.startConsensus(proof, ConsensusType.Normal);

      // 2. 只有node2接收PrePrepare消息，node3和node4不响应
      const prepareMsg2 = node2.handlePrePrepare(prePrepareMsg!);
      // node3和node4不处理PrePrepare消息

      // 3. 收集有效的Prepare消息
      const prepareMsgs = [prepareMsg2].filter(Boolean);

      // 4. 活跃节点处理所有Prepare消息
      const activeNodes = [node1, node2];
      const commitMsgs: PBFTMessage[] = [];

      for (const node of activeNodes) {
        for (const msg of prepareMsgs) {
          if (msg !== null) {
            const result = node.handlePrepare(msg);
            if (result) commitMsgs.push(result);
          }
        }
      }

      // 5. 活跃节点处理所有Commit消息
      for (const node of activeNodes) {
        for (const msg of commitMsgs) {
          node.handleCommit(msg);
        }
      }

      // 验证所有节点都没有达成共识（因为不满足2f+1条件）
      const allNodes = [node1, node2, node3, node4];
      for (const node of allNodes) {
        const callback = node['onConsensusReached'] || (node as any).consensusReachedCallback;
        expect(callback).not.toHaveBeenCalled();
      }

      // 验证活跃节点仍处于Prepare或Idle状态（未进入Committed）
      expect(node1.getState()).not.toBe(ConsensusState.Committed);
      expect(node2.getState()).not.toBe(ConsensusState.Committed);
    });
  });
});
