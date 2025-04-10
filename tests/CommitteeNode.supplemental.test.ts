import { CommitteeNode } from '../src/core/CommitteeNode';
import { QoSProof, ConsensusType, TaskProcessingState } from '../src/models/types';
import { calculateHash, sign } from '../src/utils/crypto';
// import { generateConflictProofs, generateTestProof, waitForTaskState } from './test-utils';

// 基础QoS证明生成器
function generateBaseQoSProof(taskId: string, verifierId: string): QoSProof {
  const proof: QoSProof = {
    taskId,
    verifierId,
    timestamp: Date.now(),
    mediaSpecs: {
      codec: 'H.264',
      width: 1920,
      height: 1080,
      bitrate: 5000,
      hasAudio: true,
    },
    videoQualityData: {
      overallScore: 85.5,
      gopScores: {
        '0': '86.2',
        '100': '84.8',
        '200': '85.7',
      },
    },
    audioQualityData: {
      overallScore: 90.0,
    },
    signature: '',
  };

  // 设置签名
  proof.signature = sign(proof, 'test_private_key');

  return proof;
}

// 生成结构性冲突的QoS证明对
function generateStructuralConflictProofs(
  taskId: string,
  conflictType: 'codec' | 'resolution' | 'hasAudio' | 'gop'
): QoSProof[] {
  const proof1 = generateBaseQoSProof(taskId, 'verifier1');
  const proof2 = generateBaseQoSProof(taskId, 'verifier2');

  // 根据冲突类型创建差异
  switch (conflictType) {
    case 'codec':
      proof2.mediaSpecs.codec = 'H.265'; // 编码格式不同
      break;
    case 'resolution':
      proof2.mediaSpecs.width = 1280; // 分辨率不同
      proof2.mediaSpecs.height = 720;
      break;
    case 'hasAudio':
      proof2.mediaSpecs.hasAudio = false; // 音频存在性不同
      break;
    case 'gop':
      proof2.videoQualityData.gopScores['100'] = '95.0'; // GOP评分不同
      break;
  }

  // 更新签名
  proof2.signature = sign(proof2, 'test_private_key');

  return [proof1, proof2];
}

// 生成评分差异冲突的QoS证明对
function generateScoreConflictProofs(
  taskId: string,
  conflictType: 'videoScore' | 'bitrate'
): QoSProof[] {
  const proof1 = generateBaseQoSProof(taskId, 'verifier1');
  const proof2 = generateBaseQoSProof(taskId, 'verifier2');

  // 根据冲突类型创建差异
  switch (conflictType) {
    case 'videoScore':
      proof2.videoQualityData.overallScore = proof1.videoQualityData.overallScore + 10; // 超过阈值的差异
      break;
    case 'bitrate':
      proof2.mediaSpecs.bitrate = proof1.mediaSpecs.bitrate * 1.2; // 超过5%误差
      break;
  }

  // 更新签名
  proof2.signature = sign(proof2, 'test_private_key');

  return [proof1, proof2];
}

// 生成补充验证证明 - 可以解决冲突的证明
function generateResolvingSupplementaryProof(
  taskId: string,
  originalProofs: QoSProof[],
  resolveWith: 'first' | 'second' | 'new'
): QoSProof {
  const supplementaryProof = generateBaseQoSProof(taskId, 'supplementary-verifier');

  if (resolveWith === 'first') {
    // 与第一个证明一致
    supplementaryProof.mediaSpecs = { ...originalProofs[0].mediaSpecs };
    supplementaryProof.videoQualityData = { ...originalProofs[0].videoQualityData };
    supplementaryProof.audioQualityData = { ...originalProofs[0].audioQualityData };
  } else if (resolveWith === 'second') {
    // 与第二个证明一致
    supplementaryProof.mediaSpecs = { ...originalProofs[1].mediaSpecs };
    supplementaryProof.videoQualityData = { ...originalProofs[1].videoQualityData };
    supplementaryProof.audioQualityData = { ...originalProofs[1].audioQualityData };
  }
  // 'new' 使用默认值，提供一个第三种不同的结果

  // 更新签名
  supplementaryProof.signature = sign(supplementaryProof, 'test_private_key');

  return supplementaryProof;
}

// 生成无法解决的冲突场景（三方各不相同）
function generateUnresolvableConflictScenario(taskId: string): {
  conflictProofs: QoSProof[];
  supplementaryProof: QoSProof;
} {
  const proof1 = generateBaseQoSProof(taskId, 'verifier1');
  proof1.mediaSpecs.codec = 'H.264';

  const proof2 = generateBaseQoSProof(taskId, 'verifier2');
  proof2.mediaSpecs.codec = 'H.265';

  const supplementaryProof = generateBaseQoSProof(taskId, 'supplementary-verifier');
  supplementaryProof.mediaSpecs.codec = 'VP9'; // 第三种不同的编码格式

  // 更新签名
  proof1.signature = sign(proof1, 'test_private_key');
  proof2.signature = sign(proof2, 'test_private_key');
  supplementaryProof.signature = sign(supplementaryProof, 'test_private_key');

  return {
    conflictProofs: [proof1, proof2],
    supplementaryProof,
  };
}

describe('Supplementary Proof Timing Tests', () => {
  let leaderNode: CommitteeNode;
  let followerNode1: CommitteeNode;
  let followerNode2: CommitteeNode;
  let followerNode3: CommitteeNode;
  const totalNodes = 4;

  //   let nodes: Node[];

  beforeEach(async () => {
    // 设置测试网络
    const basePort = 9000 + Math.floor(Math.random() * 1000); // 随机端口避免冲突

    // 创建节点
    leaderNode = new CommitteeNode(
      'leader',
      basePort,
      true,
      [
        `follower1:localhost:${basePort + 1}`,
        `follower2:localhost:${basePort + 2}`,
        `follower3:localhost:${basePort + 3}`,
      ],
      totalNodes
    );

    followerNode1 = new CommitteeNode(
      'follower1',
      basePort + 1,
      false,
      [
        `leader:localhost:${basePort}`,
        `follower2:localhost:${basePort + 2}`,
        `follower3:localhost:${basePort + 3}`,
      ],
      totalNodes
    );

    followerNode2 = new CommitteeNode(
      'follower2',
      basePort + 2,
      false,
      [
        `leader:localhost:${basePort}`,
        `follower1:localhost:${basePort + 1}`,
        `follower3:localhost:${basePort + 3}`,
      ],
      totalNodes
    );

    followerNode3 = new CommitteeNode(
      'follower3',
      basePort + 3,
      false,
      [
        `leader:localhost:${basePort}`,
        `follower1:localhost:${basePort + 1}`,
        `follower2:localhost:${basePort + 2}`,
      ],
      totalNodes
    );

    // 启动节点
    leaderNode.start();
    followerNode1.start();
    followerNode2.start();
    followerNode3.start();

    // 等待网络稳定
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterEach(async () => {
    // 关闭节点
    leaderNode.stop();
    followerNode1.stop();
    followerNode2.stop();
    followerNode3.stop();
  });

  test('Should complete full conflict consensus and supplementary validation consensus', async () => {
    // 设置较长的测试超时时间
    jest.setTimeout(60000);

    // 生成测试任务ID和冲突证明
    const taskId = 'full-consensus-test-' + Date.now();
    const conflictProofs = generateStructuralConflictProofs(taskId, 'codec');

    // 步骤1: 所有节点逐个接收证明，触发第一次冲突共识
    console.log('===== 步骤1: 触发第一次冲突共识 =====');

    // Leader接收第一个证明
    leaderNode.handleQoSProof(conflictProofs[0]);
    await new Promise(resolve => setTimeout(resolve, 200));

    // 其他节点也接收第一个证明
    for (const node of [followerNode1, followerNode2, followerNode3]) {
      node.handleQoSProof(conflictProofs[0]);
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 等待一会儿，确保第一个证明被处理
    await new Promise(resolve => setTimeout(resolve, 500));

    // Leader接收第二个证明（冲突证明）
    leaderNode.handleQoSProof(conflictProofs[1]);
    await new Promise(resolve => setTimeout(resolve, 200));

    // 其他节点也接收第二个证明
    for (const node of [followerNode1, followerNode2, followerNode3]) {
      node.handleQoSProof(conflictProofs[1]);
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 等待冲突共识完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 检查点1: 验证所有节点应该处于AwaitingSupplementary状态
    console.log('===== 检查点1: 验证节点状态为AwaitingSupplementary =====');
    let allNodesInCorrectState = true;

    for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
      const status = node.getTaskStatus(taskId);
      console.log(`${node.getNodeId()} 当前状态: ${status?.state}`);

      if (!status || status.state !== TaskProcessingState.AwaitingSupplementary) {
        allNodesInCorrectState = false;
        console.error(`节点 ${node.getNodeId()} 处于错误状态: ${status?.state}`);
      }
    }

    expect(allNodesInCorrectState).toBe(true);
    console.log('所有节点已进入等待补充验证状态');

    // 步骤2: 生成一个能够解决冲突的补充证明
    console.log('===== 步骤2: 启动补充验证共识 =====');
    const supplementaryProof = generateResolvingSupplementaryProof(taskId, conflictProofs, 'first');
    supplementaryProof.id = `supp-${taskId}-${Date.now()}`;

    // 步骤2.1: Leader先收到补充证明
    console.log('Leader接收补充证明');
    leaderNode.handleSupplementaryProof(taskId, supplementaryProof);

    // 等待Leader处理补充证明
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 检查点2: 验证Leader应该已处理补充证明且发送就绪消息
    const leaderStatus = leaderNode.getTaskStatus(taskId);
    expect(leaderStatus).not.toBeNull();
    expect(leaderStatus!.state).toBe(TaskProcessingState.Validated);
    console.log(`Leader状态: ${leaderStatus!.state}`);

    // 步骤2.2: 其他节点按顺序接收补充证明
    console.log('follower1接收补充证明');
    await new Promise(resolve => setTimeout(resolve, 500));
    followerNode1.handleSupplementaryProof(taskId, supplementaryProof);

    console.log('follower2接收补充证明');
    await new Promise(resolve => setTimeout(resolve, 700));
    followerNode2.handleSupplementaryProof(taskId, supplementaryProof);

    // 步骤2.3: 检查Leader是否在收到足够确认后启动最终共识
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 检查点3: 验证共识已开始
    const leaderStatusAfterConsensus = leaderNode.getTaskStatus(taskId);
    expect(leaderStatusAfterConsensus!.state).toBe(TaskProcessingState.Finalized);
    console.log(`启动共识后Leader状态: ${leaderStatusAfterConsensus!.state}`);

    // 步骤2.4: 最后一个节点延迟接收补充证明
    console.log('follower3延迟接收补充证明');
    await new Promise(resolve => setTimeout(resolve, 1000));
    followerNode3.handleSupplementaryProof(taskId, supplementaryProof);

    // 等待最终共识完成
    console.log('等待最终共识完成');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 检查点4: 验证所有节点最终都应该达到Finalized状态
    console.log('===== 检查点4: 验证所有节点达到Finalized状态 =====');
    let allNodesFinalized = true;

    for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
      const finalStatus = node.getTaskStatus(taskId);
      console.log(`${node.getNodeId()} 的最终状态: ${finalStatus?.state}`);

      if (!finalStatus || finalStatus.state !== TaskProcessingState.Finalized) {
        allNodesFinalized = false;
        console.error(`节点 ${node.getNodeId()} 未达到最终状态，当前状态: ${finalStatus?.state}`);
      }
    }

    expect(allNodesFinalized).toBe(true);
    console.log('所有节点都已达到Finalized状态，测试成功');
  }, 20000);

  // test('Should handle supplementary proof with timing differences', async () => {
  //   // 设置较长的测试超时时间
  //   jest.setTimeout(30000);

  //   // 生成测试任务ID和冲突证明
  //   const taskId = 'supplementary-timing-test-' + Date.now();
  //   const conflictProofs = generateStructuralConflictProofs(taskId, 'codec');

  //   // 步骤1: 所有节点接收两个冲突证明，进入冲突状态
  //   // Leader接收证明
  //   leaderNode.handleQoSProof(conflictProofs[0]);
  //   await new Promise(resolve => setTimeout(resolve, 100));
  //   leaderNode.handleQoSProof(conflictProofs[1]);

  //   // Follower1接收证明
  //   followerNode1.handleQoSProof(conflictProofs[0]);
  //   await new Promise(resolve => setTimeout(resolve, 100));
  //   followerNode1.handleQoSProof(conflictProofs[1]);

  //   // Follower2接收证明
  //   followerNode2.handleQoSProof(conflictProofs[0]);
  //   await new Promise(resolve => setTimeout(resolve, 100));
  //   followerNode2.handleQoSProof(conflictProofs[1]);

  //   // Follower3接收证明
  //   followerNode3.handleQoSProof(conflictProofs[0]);
  //   await new Promise(resolve => setTimeout(resolve, 100));
  //   followerNode3.handleQoSProof(conflictProofs[1]);

  //   // 等待冲突检测完成
  //   await new Promise(resolve => setTimeout(resolve, 2000));

  //   // 验证所有节点应该都处于AwaitingSupplementary状态
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     const status = node.getTaskStatus(taskId);
  //     expect(status).not.toBeNull();
  //     expect(status!.state).toBe(TaskProcessingState.AwaitingSupplementary);
  //   }

  //   console.log('所有节点已进入等待补充验证状态');

  //   // 步骤2: 生成补充证明
  //   const supplementaryProof = generateResolvingSupplementaryProof(taskId, conflictProofs, 'first');
  //   // 确保补充证明能够解决冲突
  //   // supplementaryProof.mediaSpecs = {
  //   //   ...conflictProofs[0].mediaSpecs,
  //   //   bitrate: conflictProofs[0].mediaSpecs.bitrate,
  //   // };
  //   // 添加ID以便跟踪
  //   supplementaryProof.id = `supp-${taskId}-${Date.now()}`;

  //   // 步骤3: Leader先收到补充证明
  //   console.log('Leader接收补充证明');
  //   leaderNode.handleSupplementaryProof(taskId, supplementaryProof);

  //   // 等待Leader处理补充证明
  //   await new Promise(resolve => setTimeout(resolve, 1000));

  //   // 验证Leader应该已处理补充证明且发送就绪消息
  //   const leaderStatus = leaderNode.getTaskStatus(taskId);
  //   expect(leaderStatus).not.toBeNull();
  //   expect(leaderStatus!.state).toBe(TaskProcessingState.Validated);

  //   // 步骤4: Follower1延迟接收补充证明
  //   console.log('Follower1延迟1秒接收补充证明');
  //   await new Promise(resolve => setTimeout(resolve, 1000));
  //   followerNode1.handleSupplementaryProof(taskId, supplementaryProof);

  //   // 步骤5: Follower2延迟更长时间接收补充证明
  //   console.log('Follower2延迟2秒接收补充证明');
  //   await new Promise(resolve => setTimeout(resolve, 1000));
  //   followerNode2.handleSupplementaryProof(taskId, supplementaryProof);

  //   // 步骤6: Follower3延迟最长时间接收补充证明
  //   console.log('Follower3延迟3秒接收补充证明');
  //   await new Promise(resolve => setTimeout(resolve, 1000));
  //   followerNode3.handleSupplementaryProof(taskId, supplementaryProof);

  //   // 等待最终共识完成
  //   console.log('等待最终共识完成');
  //   await new Promise(resolve => setTimeout(resolve, 1000));

  //   // 验证所有节点最终都应该达到Finalized状态
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     const finalStatus = node.getTaskStatus(taskId);
  //     expect(finalStatus).not.toBeNull();
  //     console.log(`${node.getNodeId()} 的最终状态: ${finalStatus!.state}`);
  //     expect(finalStatus!.state).toBe(TaskProcessingState.Finalized);
  //   }
  // }, 20000);

  // test('Should skip deep validation for tasks that passed supplementary validation', async () => {
  //   // 设置测试超时时间
  //   jest.setTimeout(30000);

  //   // 生成测试任务ID和冲突证明
  //   const taskId = 'supplementary-validation-test-' + Date.now();
  //   const conflictProofs = generateStructuralConflictProofs(taskId, 'codec');

  //   // 步骤1: 所有节点接收冲突证明，进入等待补充验证状态
  //   // 分发证明给所有节点
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     node.handleQoSProof(conflictProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 100));
  //     node.handleQoSProof(conflictProofs[1]);
  //   }

  //   // 等待冲突检测完成
  //   await new Promise(resolve => setTimeout(resolve, 1000));

  //   // 验证所有节点应该都处于AwaitingSupplementary状态
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     const status = node.getTaskStatus(taskId);
  //     expect(status).not.toBeNull();
  //     expect(status!.state).toBe(TaskProcessingState.AwaitingSupplementary);
  //   }

  //   console.log('所有节点已进入等待补充验证状态');

  //   // 步骤2: 生成补充证明
  //   const supplementaryProof = generateResolvingSupplementaryProof(taskId, conflictProofs, 'first');
  //   supplementaryProof.id = `supp-${taskId}-${Date.now()}`;

  //   // 添加日志监听，检查深度验证是否被跳过
  //   const originalConsoleInfo = console.info;
  //   const mockConsoleInfo = jest.fn();
  //   console.info = mockConsoleInfo;

  //   // 步骤3: 所有节点接收补充证明
  //   console.log('所有节点接收补充证明');
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     node.handleSupplementaryProof(taskId, supplementaryProof);
  //   }

  //   // 等待补充验证处理完成
  //   await new Promise(resolve => setTimeout(resolve, 1000));

  //   // 验证所有节点应该都处于Validated状态
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     const status = node.getTaskStatus(taskId);
  //     expect(status).not.toBeNull();
  //     expect(status!.state).toBe(TaskProcessingState.Validated);
  //   }

  //   // // 步骤4: Leader启动最终共识
  //   // console.log('Leader启动最终共识');
  //   // // 这里我们模拟leader启动共识
  //   // const consensusData = supplementaryProof; // 使用补充证明作为共识数据
  //   // leaderNode.startFinalConsensus(taskId, consensusData);

  //   // 等待共识完成
  //   await new Promise(resolve => setTimeout(resolve, 2000));

  //   // 恢复原始console.info
  //   console.info = originalConsoleInfo;

  //   // 检查日志，验证跳过深度验证的消息被打印
  //   const skipValidationLogs = mockConsoleInfo.mock.calls.filter(
  //     call => typeof call[0] === 'string' && call[0].includes('跳过所有验证步骤')
  //   );

  //   // 至少follower节点应该跳过验证
  //   expect(skipValidationLogs.length).toBeGreaterThan(0);

  //   // 检查是否有错误日志表明媒体规格验证失败
  //   const errorLogs = mockConsoleInfo.mock.calls.filter(
  //     call => typeof call[0] === 'string' && call[0].includes('媒体规格验证失败')
  //   );

  //   // 不应该有媒体规格验证失败的日志
  //   expect(errorLogs.length).toBe(0);

  //   // 最终所有节点应该都处于Finalized状态
  //   for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //     const finalStatus = node.getTaskStatus(taskId);
  //     expect(finalStatus).not.toBeNull();
  //     expect(finalStatus!.state).toBe(TaskProcessingState.Finalized);
  //   }
  // }, 20000);

  //   test('Should handle supplementary proof when some nodes never receive it', async () => {
  //     // 设置较长的测试超时时间
  //     jest.setTimeout(30000);

  //     // 生成测试任务ID和冲突证明
  //     const taskId = 'supplementary-incomplete-test-' + Date.now();
  //     const conflictProofs = generateConflictProofs(taskId, 'bitrate');

  //     // 步骤1: 所有节点接收两个冲突证明，进入冲突状态
  //     // 为所有节点提供冲突证明
  //     for (const node of nodes) {
  //       node.handleQoSProof(conflictProofs[0]);
  //       await new Promise(resolve => setTimeout(resolve, 100));
  //       node.handleQoSProof(conflictProofs[1]);
  //     }

  //     // 等待冲突检测完成
  //     await new Promise(resolve => setTimeout(resolve, 2000));

  //     // 验证所有节点应该都处于AwaitingSupplementary状态
  //     for (const node of nodes) {
  //       const status = node.getTaskStatus(taskId);
  //       expect(status).not.toBeNull();
  //       expect(status!.state).toBe(TaskProcessingState.AwaitingSupplementary);
  //     }

  //     console.log('所有节点已进入等待补充验证状态');

  //     // 步骤2: 生成补充证明
  //     const supplementaryProof = generateTestProof(taskId, 'verifier3');
  //     // 确保补充证明能够解决冲突
  //     supplementaryProof.mediaSpecs = {
  //       ...conflictProofs[0].mediaSpecs,
  //       bitrate: conflictProofs[0].mediaSpecs.bitrate,
  //     };
  //     // 添加ID以便跟踪
  //     supplementaryProof.id = `supp-${taskId}-${Date.now()}`;

  //     // 步骤3: 只有Leader和Follower1、Follower2接收补充证明，Follower3不接收
  //     console.log('Leader接收补充证明');
  //     leaderNode.handleSupplementaryProof(taskId, supplementaryProof);

  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     console.log('Follower1接收补充证明');
  //     followerNode1.handleSupplementaryProof(taskId, supplementaryProof);

  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     console.log('Follower2接收补充证明');
  //     followerNode2.handleSupplementaryProof(taskId, supplementaryProof);

  //     // Follower3故意不接收补充证明
  //     console.log('Follower3不接收补充证明');

  //     // 等待一段时间，看是否能完成共识
  //     console.log('等待最终共识完成');
  //     await new Promise(resolve => setTimeout(resolve, 5000));

  //     // 验证Leader、Follower1和Follower2应该达到Finalized状态
  //     // 因为我们需要2f+1=3个节点确认就足够了，所以即使Follower3没有收到补充证明也应该能完成共识
  //     for (const node of [leaderNode, followerNode1, followerNode2]) {
  //       const finalStatus = node.getTaskStatus(taskId);
  //       expect(finalStatus).not.toBeNull();
  //       console.log(`${node.getNodeId()} 的最终状态: ${finalStatus!.state}`);
  //       expect(finalStatus!.state).toBe(TaskProcessingState.Finalized);
  //     }

  //     // Follower3因为没有收到补充证明，应该仍处于AwaitingSupplementary状态
  //     const follower3Status = followerNode3.getTaskStatus(taskId);
  //     expect(follower3Status).not.toBeNull();
  //     console.log(`Follower3的最终状态: ${follower3Status!.state}`);
  //     expect(follower3Status!.state).toBe(TaskProcessingState.AwaitingSupplementary);
  //   });
});
