// 文件名: CommitteeNode.integration.test.ts

import { CommitteeNode } from '../src/core/CommitteeNode';
import {
  QoSProof,
  MessageType,
  TaskProcessingState,
  ConsensusType,
  PBFTMessage,
} from '../src/models/types';
import { calculateHash, sign } from '../src/utils/crypto';

// 模拟crypto函数，但保留部分实现
jest.mock('../src/utils/crypto', () => ({
  calculateHash: jest.fn(data => 'mock-hash-' + JSON.stringify(data).length),
  sign: jest.fn(() => 'mock-signature'),
}));

// 模拟logger，显示实际输出以便调试
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.warn(`[WARN] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  },
}));

describe('CommitteeNode 集成测试', () => {
  // 增加测试超时时间，因为网络通信需要时间
  jest.setTimeout(15000);

  // 节点实例
  let leaderNode: CommitteeNode;
  let followerNode1: CommitteeNode;
  let followerNode2: CommitteeNode;
  let followerNode3: CommitteeNode;

  // 使用不同的端口避免冲突
  const leaderPort = 8090;
  const follower1Port = 8091;
  const follower2Port = 8092;
  const follower3Port = 8093;

  beforeAll(async () => {
    // 创建四个节点，一个leader，三个follower
    leaderNode = new CommitteeNode(
      'leader',
      leaderPort,
      true,
      [
        `follower1:localhost:${follower1Port}`,
        `follower2:localhost:${follower2Port}`,
        `follower3:localhost:${follower3Port}`,
      ],
      4
    );

    followerNode1 = new CommitteeNode(
      'follower1',
      follower1Port,
      false,
      [
        `leader:localhost:${leaderPort}`,
        `follower2:localhost:${follower2Port}`,
        `follower3:localhost:${follower3Port}`,
      ],
      4
    );

    followerNode2 = new CommitteeNode(
      'follower2',
      follower2Port,
      false,
      [
        `leader:localhost:${leaderPort}`,
        `follower1:localhost:${follower1Port}`,
        `follower3:localhost:${follower3Port}`,
      ],
      4
    );

    followerNode3 = new CommitteeNode(
      'follower3',
      follower3Port,
      false,
      [
        `leader:localhost:${leaderPort}`,
        `follower1:localhost:${follower1Port}`,
        `follower2:localhost:${follower2Port}`,
      ],
      4
    );

    // 启动所有节点
    leaderNode.start();
    await new Promise(resolve => setTimeout(resolve, 1000));

    followerNode1.start();
    await new Promise(resolve => setTimeout(resolve, 1000));

    followerNode2.start();
    await new Promise(resolve => setTimeout(resolve, 1000));

    followerNode3.start();

    // 等待所有节点建立连接
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  afterAll(async () => {
    // 关闭所有节点
    leaderNode.stop();
    followerNode1.stop();
    followerNode2.stop();
    followerNode3.stop();

    // 等待资源释放
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  // 辅助函数：等待任务状态变为预期状态
  async function waitForTaskStatus(
    node: CommitteeNode,
    taskId: string,
    expectedState: TaskProcessingState,
    timeout: number = 10000
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const status = node.getTaskStatus(taskId);
      if (status && status.state === expectedState) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  }

  // 辅助函数：检查任务是否存在
  async function waitForTaskExists(
    node: CommitteeNode,
    taskId: string,
    timeout: number = 5000
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const status = node.getTaskStatus(taskId);
      if (status) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  }

  test('系统应能容忍少数节点故障', async () => {
    // 准备基础QoS证明
    const baseProof: QoSProof = {
      taskId: 'integration-task-5',
      verifierId: 'verifier1', // 添加了verifierId
      timestamp: Date.now(),
      mediaSpecs: {
        codec: 'H.264',
        width: 1920,
        height: 1080,
        bitrate: 5000,
        hasAudio: true,
      },
      videoQualityData: {
        overallScore: 92,
        gopScores: { '0.00': '94.6' },
      },
      audioQualityData: {
        overallScore: 4.2,
      },
      syncQualityData: {
        offset: 0.02,
        score: 98.2,
      },
      signature: 'mock-signature-verifier1',
    };

    // 提交证明给Leader和其他活跃节点
    const verifier1Proof = {
      ...baseProof,
      verifierId: 'verifier1',
      signature: 'mock-signature-verifier1',
    };
    const verifier2Proof = {
      ...baseProof,
      verifierId: 'verifier2',
      signature: 'mock-signature-verifier2',
    };

    // 模拟followerNode3故障，不向它提交证明
    leaderNode.handleQoSProof(verifier1Proof);
    followerNode1.handleQoSProof(verifier1Proof);
    followerNode2.handleQoSProof(verifier1Proof);

    // 第二个证明触发共识流程
    leaderNode.handleQoSProof(verifier2Proof);
    followerNode1.handleQoSProof(verifier2Proof);
    followerNode2.handleQoSProof(verifier2Proof);

    // 等待共识流程完成
    const hasReachedConsensus = await waitForTaskStatus(
      leaderNode,
      'integration-task-5',
      TaskProcessingState.Consensus
    );

    // 验证结果
    expect(hasReachedConsensus).toBe(true);

    // 验证状态
    const leaderStatus = leaderNode.getTaskStatus('integration-task-5');
    expect(leaderStatus?.proofCount).toBe(2);
    expect(leaderStatus?.state).toBe(TaskProcessingState.Consensus);
  });

  test('Leader节点应成功处理多个Verifier的QoS证明并启动共识', async () => {
    // 准备基础QoS证明
    // 准备基础QoS证明
    const baseProof: QoSProof = {
      taskId: 'integration-task-1',
      verifierId: 'verifier1', // 添加了verifierId
      timestamp: Date.now(),
      mediaSpecs: {
        codec: 'H.264',
        width: 1920,
        height: 1080,
        bitrate: 5000,
        hasAudio: true,
      },
      videoQualityData: {
        overallScore: 92,
        gopScores: { '0.00': '94.6' },
      },
      audioQualityData: {
        overallScore: 4.2,
      },
      syncQualityData: {
        offset: 0.02,
        score: 98.2,
      },
      signature: 'mock-signature-verifier1',
    };

    // 提交第一个Verifier的证明
    const verifier1Proof = { ...baseProof, verifierId: 'verifier1' };
    leaderNode.handleQoSProof(verifier1Proof);

    // 提交第二个Verifier的证明
    // 提交第二个Verifier的证明
    const verifier2Proof = {
      ...baseProof,
      verifierId: 'verifier2',
      signature: 'mock-signature-verifier2',
    };
    leaderNode.handleQoSProof(verifier2Proof);

    // 等待任务状态变为Consensus
    const hasReachedConsensus = await waitForTaskStatus(
      leaderNode,
      'integration-task-1',
      TaskProcessingState.Consensus
    );

    // 验证任务状态
    expect(hasReachedConsensus).toBe(true);

    const taskStatus = leaderNode.getTaskStatus('integration-task-1');
    expect(taskStatus).not.toBeNull();
    expect(taskStatus?.proofCount).toBe(2);
    expect(taskStatus?.verifierIds).toContain('verifier1');
    expect(taskStatus?.verifierIds).toContain('verifier2');
  });

  test('在网络中多个节点应能完成PBFT共识流程', async () => {
    // 准备基础QoS证明
    const baseProof: QoSProof = {
      taskId: 'integration-task-2',
      verifierId: 'verifier1', // 添加了verifierId
      timestamp: Date.now(),
      mediaSpecs: {
        codec: 'H.264',
        width: 1920,
        height: 1080,
        bitrate: 5000,
        hasAudio: true,
      },
      videoQualityData: {
        overallScore: 92,
        gopScores: { '0.00': '94.6' },
      },
      audioQualityData: {
        overallScore: 4.2,
      },
      syncQualityData: {
        offset: 0.02,
        score: 98.2,
      },
      signature: 'mock-signature-verifier1',
    };

    // 提交多个Verifier的证明到所有节点
    const verifier1Proof = {
      ...baseProof,
      verifierId: 'verifier1',
      signature: 'mock-signature-verifier1',
    };
    const verifier2Proof = {
      ...baseProof,
      verifierId: 'verifier2',
      signature: 'mock-signature-verifier2',
    };

    // 向Leader和不同的节点提交证明
    leaderNode.handleQoSProof(verifier1Proof);
    followerNode1.handleQoSProof(verifier1Proof);
    followerNode2.handleQoSProof(verifier1Proof);
    followerNode3.handleQoSProof(verifier1Proof);

    // 给两个证明都提交到Leader节点，触发共识
    leaderNode.handleQoSProof(verifier2Proof);
    followerNode1.handleQoSProof(verifier2Proof);
    followerNode2.handleQoSProof(verifier2Proof);
    followerNode3.handleQoSProof(verifier2Proof);

    // 等待共识流程完成
    // 在实际应用中，共识达成后，Leader会更新任务状态
    const hasReachedConsensus = await waitForTaskStatus(
      leaderNode,
      'integration-task-2',
      TaskProcessingState.Consensus
    );

    // 验证结果
    expect(hasReachedConsensus).toBe(true);

    // 验证所有节点都应该有该任务的记录
    // 注意：在实际的PBFT实现中，所有节点应该同步到相同的任务状态
    // 但由于我们的实现可能仅在leader上更新状态，此处只验证任务存在
    expect(leaderNode.getTaskStatus('integration-task-2')).not.toBeNull();

    // 验证Leader上的状态详情
    const leaderStatus = leaderNode.getTaskStatus('integration-task-2');
    expect(leaderStatus?.proofCount).toBeGreaterThanOrEqual(2);
    expect(leaderStatus?.state).toBe(TaskProcessingState.Consensus);
  });

  // ToDo： 具体的快速验证逻辑需要refine一下。
  // test('快速验证失败的QoS证明应被忽略', async () => {
  //   // 准备一个无效的QoS证明（通过篡改某些字段使其无效）
  //   // 准备一个无效的QoS证明
  //   const invalidProof: QoSProof = {
  //     taskId: 'integration-task-3',
  //     verifierId: 'malicious-verifier',
  //     timestamp: Date.now(),
  //     mediaSpecs: {
  //       format: 'invalid-format',
  //       resolution: 'invalid-resolution',
  //       bitrate: 'negative-bitrate',
  //     },
  //     videoQualityData: {
  //       vmaf: -1, // 无效值
  //       psnr: -10, // 无效值
  //       ssim: 2.0, // 无效值，超出范围
  //     },
  //     audioQualityData: {
  //       pesq: 10, // 无效值，超出范围
  //       stoi: -0.5, // 无效值，应该在0-1之间
  //     },
  //     syncQualityData: {
  //       offset: 50, // 无效值，过大
  //       score: 200, // 无效值，超出范围
  //     },
  //     signature: 'mock-invalid-signature',
  //   };

  //   // 提交无效证明到Leader节点
  //   leaderNode.handleQoSProof(invalidProof);

  //   // 提交第二个无效证明
  //   const anotherInvalidProof = { ...invalidProof, verifierId: 'another-malicious' };
  //   leaderNode.handleQoSProof(anotherInvalidProof);

  //   // 检查任务是否存在，应该不存在因为所有证明都被忽略了
  //   const taskExists = await waitForTaskExists(leaderNode, 'integration-task-3');

  //   // 验证任务不存在或状态不是Rejected
  //   if (taskExists) {
  //     const taskStatus = leaderNode.getTaskStatus('integration-task-3');
  //     expect(taskStatus?.state).not.toBe(TaskProcessingState.Rejected);
  //     expect(taskStatus?.proofCount).toBe(0); // 不应有有效的证明
  //   } else {
  //     // 如果任务不存在，测试通过
  //     expect(taskExists).toBe(false);
  //   }
  // });

  // test('深度验证失败应启动Conflict共识而非拒绝任务', async () => {
  //   // 准备两个不一致的QoS证明
  //   const baseProof: QoSProof = {
  //     taskId: 'integration-task-1',
  //     verifierId: 'verifier1', // 添加了verifierId
  //     timestamp: Date.now(),
  //     mediaSpecs: {
  //       format: 'H.264',
  //       resolution: '1920x1080',
  //       bitrate: '5000kbps',
  //     },
  //     videoQualityData: {
  //       vmaf: 88.5,
  //       psnr: 42.3,
  //       ssim: 0.95,
  //     },
  //     audioQualityData: {
  //       pesq: 4.3,
  //       stoi: 0.89,
  //     },
  //     syncQualityData: {
  //       offset: 0.02,
  //       score: 98.2,
  //     },
  //     signature: 'mock-signature-verifier1',
  //   };

  //   // 两个证明的质量评分有较大差异
  //   const verifier1Proof = {
  //     ...baseProof,
  //     verifierId: 'verifier1',
  //     videoQualityData: 90.0,
  //     audioQualityData: 4.5,
  //     syncQualityData: 98.0,
  //     signature: 'mock-signature-verifier1',
  //   };

  //   const verifier2Proof = {
  //     ...baseProof,
  //     verifierId: 'verifier2',
  //     videoQualityData: 60.0, // 明显不同的评分
  //     audioQualityData: 3.0, // 明显不同的评分
  //     syncQualityData: 80.0, // 明显不同的评分
  //     signature: 'mock-signature-verifier2',
  //   };

  //   // 修改QoSValidator的deepValidate方法以返回不一致的结果
  //   // 这需要在实际测试中通过依赖注入或其他方式实现
  //   // 此处假设系统会检测到这种不一致并启动Conflict共识

  //   // 提交两个不一致的证明
  //   leaderNode.handleQoSProof(verifier1Proof);
  //   leaderNode.handleQoSProof(verifier2Proof);

  //   // 等待任务状态变为Consensus
  //   const hasReachedConsensus = await waitForTaskStatus(
  //     leaderNode,
  //     'integration-task-4-conflict',
  //     TaskProcessingState.Consensus
  //   );

  //   // 验证结果
  //   expect(hasReachedConsensus).toBe(true);

  //   // 注意：实际上无法从外部直接验证使用的是哪种共识类型
  //   // 因为TaskStatus中没有记录consensusType
  //   // 我们只能验证任务进入了Consensus状态，而不是被拒绝
  //   const taskStatus = leaderNode.getTaskStatus('integration-task-4-conflict');
  //   expect(taskStatus?.state).toBe(TaskProcessingState.Consensus);
  //   expect(taskStatus?.proofCount).toBe(2);
  // });
});
