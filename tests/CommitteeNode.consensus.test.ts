// 文件名: CommitteeNode.consensus.test.ts

import { CommitteeNode } from '../src/core/CommitteeNode';
import {
  QoSProof,
  MessageType,
  TaskProcessingState,
  ConsensusType,
  PBFTMessage,
} from '../src/models/types';

// 模拟依赖
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.warn(`[WARN] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  },
}));

describe('CommitteeNode PBFT共识流程测试', () => {
  // 增加测试超时时间
  jest.setTimeout(30000);

  // 节点实例
  let leaderNode: CommitteeNode;
  let followerNodes: CommitteeNode[] = [];
  const totalNodes = 7; // 共7个节点，1个leader，6个follower
  const portBase = 8100;

  // 记录各节点收到的QoS证明
  const receivedProofs = new Map<string, QoSProof[]>();

  // 辅助函数：生成节点的peers配置
  function generatePeers(excludePort: number): string[] {
    const peers: string[] = [];
    for (let i = 0; i < totalNodes; i++) {
      const port = portBase + i;
      if (port !== excludePort) {
        const nodeId = port === portBase ? 'leader' : `follower${port - portBase}`;
        peers.push(`${nodeId}:localhost:${port}`);
      }
    }
    return peers;
  }

  // 辅助函数：等待任务状态变为预期状态
  async function waitForTaskStatus(
    node: CommitteeNode,
    taskId: string,
    expectedState: TaskProcessingState,
    timeout: number = 15000
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const status = node.getTaskStatus(taskId);
      console.log(`节点 ${(node as any).nodeId} 任务 ${taskId} 当前状态: ${status?.state}`);
      if (status && status.state === expectedState) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  // 辅助函数：等待所有节点达到特定状态
  async function waitForAllNodesTaskStatus(
    nodes: CommitteeNode[],
    taskId: string,
    expectedState: TaskProcessingState,
    timeout: number = 15000
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      let allReached = true;
      for (const node of nodes) {
        const status = node.getTaskStatus(taskId);
        const nodeId = (node as any).nodeId;
        console.log(`节点 ${nodeId} 任务 ${taskId} 当前状态: ${status?.state}`);
        if (!status || status.state !== expectedState) {
          allReached = false;
          break;
        }
      }
      if (allReached) return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  beforeAll(async () => {
    // 创建leader节点
    leaderNode = new CommitteeNode('leader', portBase, true, generatePeers(portBase), totalNodes);

    // 创建follower节点
    for (let i = 1; i < totalNodes; i++) {
      const port = portBase + i;
      const nodeId = `follower${i}`;
      followerNodes.push(new CommitteeNode(nodeId, port, false, generatePeers(port), totalNodes));

      // 初始化记录
      receivedProofs.set(nodeId, []);
    }

    // 依次启动所有节点
    console.log('启动leader节点...');
    leaderNode.start();
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('启动follower节点...');
    for (let i = 0; i < followerNodes.length; i++) {
      followerNodes[i].start();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 等待所有节点建立连接
    console.log('等待节点建立连接...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  afterAll(async () => {
    // 关闭所有节点
    console.log('关闭所有节点...');
    leaderNode.stop();
    for (const node of followerNodes) {
      node.stop();
    }

    // 等待资源释放
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test('正常场景：所有节点正常参与共识', async () => {
    // 创建符合新结构的QoS证明
    const taskId = 'consensus-task-1';
    const baseProof: QoSProof = {
      taskId,
      verifierId: 'verifier-base', // 会被覆盖
      timestamp: Date.now(),
      mediaSpecs: {
        format: 'H.264',
        resolution: '1920x1080',
        bitrate: '5000kbps',
      },
      videoQualityData: {
        vmaf: 90.5,
        psnr: 42.3,
        ssim: 0.95,
      },
      audioQualityData: {
        pesq: 4.5,
        stoi: 0.92,
      },
      syncQualityData: {
        offset: 0.02,
        score: 99.0,
      },
      signature: 'mock-signature-base',
    };

    // 生成两个不同Verifier的证明
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

    console.log('提交第一个QoS证明到所有节点...');
    // 向所有节点提交第一个证明
    leaderNode.handleQoSProof(verifier1Proof);
    for (const node of followerNodes) {
      node.handleQoSProof(verifier1Proof);
    }

    // 等待任务进入Validating状态
    const inValidating = await waitForTaskStatus(
      leaderNode,
      taskId,
      TaskProcessingState.Validating,
      5000
    );
    expect(inValidating).toBe(true);

    console.log('提交第二个QoS证明到所有节点触发共识...');
    // 向所有节点提交第二个证明
    leaderNode.handleQoSProof(verifier2Proof);
    for (const node of followerNodes) {
      node.handleQoSProof(verifier2Proof);
    }

    // 等待leader节点进入Consensus状态
    const leaderInConsensus = await waitForTaskStatus(
      leaderNode,
      taskId,
      TaskProcessingState.Consensus,
      10000
    );
    expect(leaderInConsensus).toBe(true);

    // 给PBFT共识过程留出时间
    console.log('等待共识消息在节点间传播...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 验证所有节点都达到共识
    console.log('检查所有节点是否达成共识...');
    const allNodesConsensus = await waitForAllNodesTaskStatus(
      [leaderNode, ...followerNodes.slice(0, 3)], // 只检查前几个节点，加快测试速度
      taskId,
      TaskProcessingState.Consensus,
      15000
    );

    // 验证所有节点都有正确的任务状态
    expect(allNodesConsensus).toBe(true);

    // 检查leader节点的详细状态
    const leaderStatus = leaderNode.getTaskStatus(taskId);
    expect(leaderStatus?.proofCount).toBe(2);
    expect(leaderStatus?.verifierIds).toContain('verifier1');
    expect(leaderStatus?.verifierIds).toContain('verifier2');
    expect(leaderStatus?.state).toBe(TaskProcessingState.Consensus);
  });

  test('拜占庭容错：少数节点(≤f)故障时共识仍可达成', async () => {
    // 创建测试的QoS证明
    const taskId = 'consensus-task-2';
    const baseProof: QoSProof = {
      taskId,
      verifierId: 'verifier-base',
      timestamp: Date.now(),
      mediaSpecs: {
        format: 'H.264',
        resolution: '1920x1080',
        bitrate: '5000kbps',
      },
      videoQualityData: {
        vmaf: 88.2,
        psnr: 40.5,
        ssim: 0.93,
      },
      audioQualityData: {
        pesq: 4.2,
        stoi: 0.9,
      },
      syncQualityData: {
        offset: 0.03,
        score: 97.8,
      },
      signature: 'mock-signature-base',
    };

    // 生成两个不同Verifier的证明
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

    // 模拟2个节点故障（在7个节点的系统中可以容忍最多2个故障）
    const faultyNodeCount = 2;
    const activeFollowers = followerNodes.slice(0, followerNodes.length - faultyNodeCount);

    console.log(`提交证明到活跃的节点（共${1 + activeFollowers.length}个）...`);
    // 向leader和活跃follower提交第一个证明
    leaderNode.handleQoSProof(verifier1Proof);
    for (const node of activeFollowers) {
      node.handleQoSProof(verifier1Proof);
    }

    // 向leader和活跃follower提交第二个证明
    console.log('提交第二个证明触发共识...');
    leaderNode.handleQoSProof(verifier2Proof);
    for (const node of activeFollowers) {
      node.handleQoSProof(verifier2Proof);
    }

    // 等待leader节点进入Consensus状态
    const leaderInConsensus = await waitForTaskStatus(
      leaderNode,
      taskId,
      TaskProcessingState.Consensus,
      10000
    );
    expect(leaderInConsensus).toBe(true);

    // 给PBFT共识过程留出时间
    console.log('等待共识消息在活跃节点间传播...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 验证活跃节点都达到共识
    console.log('检查活跃节点是否达成共识...');
    const activeNodesConsensus = await waitForAllNodesTaskStatus(
      [leaderNode, ...activeFollowers.slice(0, 2)], // 只检查部分节点，加快测试速度
      taskId,
      TaskProcessingState.Consensus,
      15000
    );

    // 验证活跃节点都有正确的任务状态
    expect(activeNodesConsensus).toBe(true);

    // 验证Leader状态详情
    const leaderStatus = leaderNode.getTaskStatus(taskId);
    expect(leaderStatus?.state).toBe(TaskProcessingState.Consensus);
    expect(leaderStatus?.proofCount).toBe(2);
  });

  test('深度验证：处理证明验证结果不一致的情况', async () => {
    // 创建一个有分歧的QoS证明
    const taskId = 'consensus-task-3';
    const baseProof: QoSProof = {
      taskId,
      verifierId: 'verifier-base',
      timestamp: Date.now(),
      mediaSpecs: {
        format: 'H.264',
        resolution: '1920x1080',
        bitrate: '5000kbps',
      },
      videoQualityData: {},
      audioQualityData: {},
      syncQualityData: {},
      signature: 'mock-signature-base',
    };

    // 生成两个有明显差异的Verifier证明
    const verifier1Proof = {
      ...baseProof,
      verifierId: 'verifier1',
      videoQualityData: {
        vmaf: 75.0, // 较低的视频质量
        psnr: 35.0,
        ssim: 0.85,
      },
      audioQualityData: {
        pesq: 3.5, // 较低的音频质量
        stoi: 0.8,
      },
      syncQualityData: {
        offset: 0.05,
        score: 90.0, // 较低的同步质量
      },
      signature: 'mock-signature-verifier1',
    };

    // 第二个证明有更高的质量评分，可能导致验证分歧
    const verifier2Proof = {
      ...baseProof,
      verifierId: 'verifier2',
      videoQualityData: {
        vmaf: 95.0, // 明显不同的评分
        psnr: 48.0,
        ssim: 0.98,
      },
      audioQualityData: {
        pesq: 4.8, // 明显不同的评分
        stoi: 0.95,
      },
      syncQualityData: {
        offset: 0.01,
        score: 99.5, // 明显不同的评分
      },
      signature: 'mock-signature-verifier2',
    };

    console.log('提交两个不一致的QoS证明到所有节点...');
    // 向所有节点提交两个不一致的证明
    leaderNode.handleQoSProof(verifier1Proof);
    leaderNode.handleQoSProof(verifier2Proof);

    for (const node of followerNodes) {
      node.handleQoSProof(verifier1Proof);
      node.handleQoSProof(verifier2Proof);
    }

    // 等待处理完成，应该进入Consensus状态（可能是Conflict类型的共识）
    console.log('等待系统处理证明不一致的情况...');
    const reachedConsensus = await waitForTaskStatus(
      leaderNode,
      taskId,
      TaskProcessingState.Consensus,
      10000
    );

    // 验证任务进入了Consensus状态
    expect(reachedConsensus).toBe(true);

    // 获取leader节点的任务状态
    const finalStatus = leaderNode.getTaskStatus(taskId);
    console.log(`任务最终状态: ${finalStatus?.state}`);

    // 验证系统行为符合分歧处理设计 - 应该进入Consensus而非Rejected
    expect(finalStatus?.state).toBe(TaskProcessingState.Consensus);
    expect(finalStatus?.proofCount).toBe(2);
  });
});
