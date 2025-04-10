// tests/integration/ConflictResolutionTest.test.ts

import { CommitteeNode } from '../src/core/CommitteeNode';
import { QoSProof, TaskProcessingState } from '../src/models/types';
import { calculateHash, sign } from '../src/utils/crypto';

// ---------------------- 测试辅助工具 - QoS证明生成器 ----------------------

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

// ---------------------- 测试辅助工具 - 状态等待与模拟 ----------------------

// 等待特定任务状态
const waitForTaskState = async (
  node: CommitteeNode,
  taskId: string,
  state: TaskProcessingState,
  timeout = 5000
): Promise<any> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const taskStatus = node.getTaskStatus(taskId);
    if (taskStatus && taskStatus.state === state) {
      return taskStatus;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
};

// 模拟超时回调
const mockTimeout = (node: CommitteeNode, taskId: string): void => {
  // 查找并模拟超时回调
  jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, ms?: number) => {
    if (ms === 2 * 60 * 60 * 1000) {
      // 2小时超时
      // 立即执行超时回调
      callback();
    }
    return { ref: () => {}, unref: () => {} } as unknown as NodeJS.Timeout;
  });
};

// ---------------------- 集成测试 ----------------------

jest.setTimeout(30000); // 延长测试超时时间

describe('Conflict Resolution Integration Tests', () => {
  let leaderNode: CommitteeNode;
  let followerNode1: CommitteeNode;
  let followerNode2: CommitteeNode;
  let followerNode3: CommitteeNode;
  const totalNodes = 4;

  beforeAll(async () => {
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

  afterAll(async () => {
    // 关闭节点
    leaderNode.stop();
    followerNode1.stop();
    followerNode2.stop();
    followerNode3.stop();
  });

  // 测试场景1: 结构性冲突检测和状态流转;
  test('测试场景1: 结构性冲突检测和状态流转', async () => {
    // 生成一个带有结构性冲突的QoS证明集 (编码格式冲突)
    const taskId = 'structural-conflict-' + Date.now();
    const conflictingProofs = generateStructuralConflictProofs(taskId, 'codec');

    console.log(conflictingProofs[0]);

    // 提交第一个证明
    leaderNode.handleQoSProof(conflictingProofs[0]);
    followerNode1.handleQoSProof(conflictingProofs[0]);
    followerNode2.handleQoSProof(conflictingProofs[0]);
    followerNode3.handleQoSProof(conflictingProofs[0]);

    // 等待初始处理
    await new Promise(resolve => setTimeout(resolve, 500));

    // 提交第二个证明(有冲突)
    leaderNode.handleQoSProof(conflictingProofs[1]);

    // const conflictStatus = await waitForTaskState(
    //   leaderNode,
    //   taskId,
    //   TaskProcessingState.Conflict,
    //   5000
    // );
    // expect(conflictStatus).not.toBeNull();
    // expect(conflictStatus?.validationInfo?.conflictType).toBe('structural');

    followerNode1.handleQoSProof(conflictingProofs[1]);
    followerNode2.handleQoSProof(conflictingProofs[1]);
    followerNode3.handleQoSProof(conflictingProofs[1]);

    // 验证状态流转到Conflict

    // 验证状态流转到AwaitingSupplementary
    const awaitingStatus = await waitForTaskState(
      leaderNode,
      taskId,
      TaskProcessingState.AwaitingSupplementary,
      5000
    );
    expect(awaitingStatus).not.toBeNull();
    expect(awaitingStatus?.validationInfo?.supplementaryRequested).toBe(true);
  });

  //   // 测试场景2: 评分差异冲突检测
  //   test('评分差异冲突检测', async () => {
  //     // 生成一个带有评分差异冲突的QoS证明集
  //     const taskId = 'score-conflict-' + Date.now();
  //     const conflictingProofs = generateScoreConflictProofs(taskId, 'videoScore');

  //     // 提交证明
  //     leaderNode.handleQoSProof(conflictingProofs[0]);
  //     followerNode1.handleQoSProof(conflictingProofs[0]);
  //     followerNode2.handleQoSProof(conflictingProofs[0]);
  //     followerNode3.handleQoSProof(conflictingProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 500));
  //     leaderNode.handleQoSProof(conflictingProofs[1]);
  //     followerNode1.handleQoSProof(conflictingProofs[1]);
  //     followerNode2.handleQoSProof(conflictingProofs[1]);
  //     followerNode3.handleQoSProof(conflictingProofs[1]);

  //     // 验证冲突检测
  //     // const conflictStatus = await waitForTaskState(
  //     //   leaderNode,
  //     //   taskId,
  //     //   TaskProcessingState.Conflict,
  //     //   5000
  //     // );
  //     // expect(conflictStatus).not.toBeNull();
  //     // expect(conflictStatus?.validationInfo?.conflictType).toBe('score');

  //     // 验证状态流转
  //     const awaitingStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.AwaitingSupplementary,
  //       5000
  //     );
  //     expect(awaitingStatus).not.toBeNull();
  //   });

  // 测试场景3: 补充验证成功解决结构性冲突
  //   test('Should resolve structural conflict with supplementary verification', async () => {
  //     // 生成冲突场景
  //     const taskId = 'resolve-structural-' + Date.now();
  //     const conflictingProofs = generateStructuralConflictProofs(taskId, 'resolution');

  //     // 提交初始证明
  //     leaderNode.handleQoSProof(conflictingProofs[0]);
  //     followerNode1.handleQoSProof(conflictingProofs[0]);
  //     followerNode2.handleQoSProof(conflictingProofs[0]);
  //     followerNode3.handleQoSProof(conflictingProofs[0]);

  //     await new Promise(resolve => setTimeout(resolve, 500));

  //     leaderNode.handleQoSProof(conflictingProofs[1]);

  //     followerNode1.handleQoSProof(conflictingProofs[1]);
  //     followerNode2.handleQoSProof(conflictingProofs[1]);
  //     followerNode3.handleQoSProof(conflictingProofs[1]);

  //     // 等待进入补充验证状态
  //     const awaitingStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.AwaitingSupplementary,
  //       5000
  //     );
  //     expect(awaitingStatus).not.toBeNull();

  //     // 生成解决冲突的补充证明 (与第一个一致)
  //     const supplementaryProof = generateResolvingSupplementaryProof(
  //       taskId,
  //       conflictingProofs,
  //       'first'
  //     );

  //     // 提交补充证明
  //     leaderNode.handleSupplementaryProof(taskId, supplementaryProof);
  //     followerNode1.handleSupplementaryProof(taskId, supplementaryProof);
  //     followerNode2.handleSupplementaryProof(taskId, supplementaryProof);
  //     followerNode3.handleSupplementaryProof(taskId, supplementaryProof);

  //     // 验证冲突解决
  //     // const validatedStatus = await waitForTaskState(
  //     //   leaderNode,
  //     //   taskId,
  //     //   TaskProcessingState.Validated,
  //     //   5000
  //     // );
  //     // expect(validatedStatus).not.toBeNull();

  //     // 验证最终状态
  //     const finalizedStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.Finalized,
  //       10000
  //     );
  //     expect(finalizedStatus).not.toBeNull();
  //   });

  // 测试场景4: 补充验证成功解决评分差异冲突;
  //   test('Should resolve score conflict with supplementary verification', async () => {
  //     // 生成冲突场景
  //     const taskId = 'resolve-score-' + Date.now();
  //     const conflictingProofs = generateScoreConflictProofs(taskId, 'bitrate');

  //     // 提交初始证明
  //     leaderNode.handleQoSProof(conflictingProofs[0]);
  //     followerNode1.handleQoSProof(conflictingProofs[0]);
  //     followerNode2.handleQoSProof(conflictingProofs[0]);
  //     followerNode3.handleQoSProof(conflictingProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 500));
  //     leaderNode.handleQoSProof(conflictingProofs[1]);
  //     followerNode1.handleQoSProof(conflictingProofs[1]);
  //     followerNode2.handleQoSProof(conflictingProofs[1]);
  //     followerNode3.handleQoSProof(conflictingProofs[1]);

  //     // 等待进入补充验证状态
  //     const awaitingStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.AwaitingSupplementary,
  //       5000
  //     );
  //     expect(awaitingStatus).not.toBeNull();

  //     // 生成解决冲突的补充证明 (与第二个一致)
  //     const supplementaryProof = generateResolvingSupplementaryProof(
  //       taskId,
  //       conflictingProofs,
  //       'second'
  //     );

  //     // 提交补充证明
  //     leaderNode.handleSupplementaryProof(taskId, supplementaryProof);

  //     // 验证冲突解决
  //     // const validatedStatus = await waitForTaskState(
  //     //   leaderNode,
  //     //   taskId,
  //     //   TaskProcessingState.Validated,
  //     //   5000
  //     // );
  //     // expect(validatedStatus).not.toBeNull();

  //     // 验证最终状态
  //     const finalizedStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.Finalized,
  //       10000
  //     );
  //     expect(finalizedStatus).not.toBeNull();
  //   });

  // 测试场景5: 补充验证无法解决冲突，需要人工审核
  //   test('Should transition to NeedsManualReview when supplementary verification cannot resolve conflict', async () => {
  //     // 生成无法解决的冲突场景
  //     const taskId = 'unresolvable-' + Date.now();
  //     const { conflictProofs, supplementaryProof } = generateUnresolvableConflictScenario(taskId);

  //     // 提交初始证明
  //     leaderNode.handleQoSProof(conflictProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 500));
  //     leaderNode.handleQoSProof(conflictProofs[1]);

  //     // 等待进入补充验证状态
  //     const awaitingStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.AwaitingSupplementary,
  //       5000
  //     );
  //     expect(awaitingStatus).not.toBeNull();

  //     // 提交补充证明 (与前两个都不同)
  //     leaderNode.handleSupplementaryProof(taskId, supplementaryProof);

  //     // 验证状态流转到需要人工审核
  //     const manualReviewStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.NeedsManualReview,
  //       5000
  //     );
  //     expect(manualReviewStatus).not.toBeNull();
  //     expect(manualReviewStatus?.validationInfo?.resolvedResult?.needsManualReview).toBe(true);
  //   });

  //   // 测试场景6: 补充验证超时
  //   test('Should transition to NeedsManualReview after supplementary verification timeout', async () => {
  //     // 启用Jest的定时器模拟
  //     // jest.useFakeTimers();
  //     // jest.useFakeTimers({
  //     //   legacyFakeTimers: false,
  //     // });

  //     // 生成冲突场景
  //     const taskId = 'timeout-' + Date.now();
  //     const conflictingProofs = generateStructuralConflictProofs(taskId, 'codec');

  //     // 提交初始证明
  //     leaderNode.handleQoSProof(conflictingProofs[0]);
  //     followerNode1.handleQoSProof(conflictingProofs[0]);
  //     followerNode2.handleQoSProof(conflictingProofs[0]);
  //     followerNode3.handleQoSProof(conflictingProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 500));
  //     // await new Promise(resolve => setTimeout(resolve, 500));
  //     // jest.advanceTimersByTime(500); // 推进定时器
  //   leaderNode.handleQoSProof(conflictingProofs[1]);
  //   followerNode1.handleQoSProof(conflictingProofs[1]);
  //   followerNode2.handleQoSProof(conflictingProofs[1]);
  //   followerNode3.handleQoSProof(conflictingProofs[1]);

  //   // 等待进入补充验证状态
  //   const awaitingStatus = await waitForTaskState(
  //     leaderNode,
  //     taskId,
  //     TaskProcessingState.AwaitingSupplementary,
  //     5000
  //   );
  //   expect(awaitingStatus).not.toBeNull();

  //   // 直接调用超时检查，模拟2小时已过
  //   leaderNode.forceCheckTimeout(taskId);

  //   // 验证状态变为需要人工审核
  //   const manualReviewStatus = await waitForTaskState(
  //     leaderNode,
  //     taskId,
  //     TaskProcessingState.NeedsManualReview,
  //     5000
  //   );

  //   expect(manualReviewStatus).not.toBeNull();
  //   expect(manualReviewStatus?.validationInfo?.timeoutReason).toContain('超时');

  //   const manualReviewStatus = await waitForTaskState(
  //     leaderNode,
  //     taskId,
  //     TaskProcessingState.NeedsManualReview,
  //     5000
  //   );

  //   console.log('最终状态检查结果:', manualReviewStatus?.state);

  //   expect(manualReviewStatus).not.toBeNull();
  //   expect(manualReviewStatus?.validationInfo?.timeoutReason).toContain('超时');
  //   });

  //   test('Should fail consensus when only leader has proofs', async () => {
  //     // 生成冲突场景
  //     const taskId = 'leader-only-proofs-' + Date.now();
  //     const conflictingProofs = generateScoreConflictProofs(taskId, 'bitrate');

  //     // 只向leader提交证明
  //     leaderNode.handleQoSProof(conflictingProofs[0]);
  //     await new Promise(resolve => setTimeout(resolve, 500));
  //     leaderNode.handleQoSProof(conflictingProofs[1]);

  //     // 等待一段时间，允许共识尝试启动
  //     await new Promise(resolve => setTimeout(resolve, 2000));

  //     // 检查任务状态 - 由于follower没有足够证明，预期共识无法达成
  //     // 任务应该保持在Consensus状态而不会进入AwaitingSupplementary
  //     const currentStatus = leaderNode.getTaskStatus(taskId);

  //     // 验证任务状态
  //     expect(currentStatus).not.toBeNull();
  //     expect(currentStatus!.state).toBe(TaskProcessingState.Consensus);

  //     // 可以进一步检查日志中是否有follower拒绝参与共识的记录
  //     // 这需要在测试框架中捕获日志输出

  //     // 确认任务未进入补充验证状态
  //     const awaitingStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.AwaitingSupplementary,
  //       3000 // 短一些的超时时间，因为我们预期不会进入此状态
  //     );
  //     expect(awaitingStatus).toBeNull();

  //     // 确认任务未被最终确认
  //     const finalizedStatus = await waitForTaskState(
  //       leaderNode,
  //       taskId,
  //       TaskProcessingState.Finalized,
  //       3000 // 同样使用短超时时间
  //     );
  //     expect(finalizedStatus).toBeNull();
  //   });

  //   test('Should achieve consensus with time-delayed proof reception', async () => {
  //     // 生成测试任务和证明
  //     const taskId = 'time-delayed-task-' + Date.now();
  //     const proof1 = generateBaseQoSProof(taskId, 'verifier1');
  //     const proof2 = generateBaseQoSProof(taskId, 'verifier2');

  //     // 设置较长的测试超时时间
  //     jest.setTimeout(15000);

  //     // 第1步：Leader先收到所有证明
  //     leaderNode.handleQoSProof(proof1);
  //     await new Promise(resolve => setTimeout(resolve, 100));
  //     leaderNode.handleQoSProof(proof2);

  //     // 等待一段时间，让Leader启动共识
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     // 验证Leader已启动共识
  //     const leaderStatusAfterProofs = leaderNode.getTaskStatus(taskId);
  //     expect(leaderStatusAfterProofs).not.toBeNull();
  //     expect(leaderStatusAfterProofs!.state).toBe(TaskProcessingState.Consensus);

  //     // 第2步：Follower1收到所有证明（延迟1秒）
  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     followerNode1.handleQoSProof(proof1);
  //     await new Promise(resolve => setTimeout(resolve, 100));
  //     followerNode1.handleQoSProof(proof2);

  //     // 第3步：Follower2收到所有证明（再延迟1秒）
  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     followerNode2.handleQoSProof(proof1);
  //     await new Promise(resolve => setTimeout(resolve, 100));
  //     followerNode2.handleQoSProof(proof2);

  //     // 第4步：Follower3收到所有证明（再延迟1秒）
  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     followerNode3.handleQoSProof(proof1);
  //     await new Promise(resolve => setTimeout(resolve, 100));
  //     followerNode3.handleQoSProof(proof2);

  //     // 等待足够时间让共识完成
  //     await new Promise(resolve => setTimeout(resolve, 3000));

  //     // 检查所有节点是否都达成了共识
  //     for (const node of [leaderNode, followerNode1, followerNode2, followerNode3]) {
  //       const finalStatus = node.getTaskStatus(taskId);
  //       expect(finalStatus).not.toBeNull();
  //       expect(finalStatus!.state).toBe(TaskProcessingState.Finalized);
  //       console.log(`${node.getNodeId()}完成Finalized`);
  //     }

  //     // 测试成功完成，表明即使证明接收有时间差，修改后的PBFT也能正确处理
  //   });

  test('Should handle delayed but insufficient proofs correctly', async () => {
    // 生成测试任务和证明
    const taskId = 'delayed-insufficient-proofs-' + Date.now();
    const proof1 = generateBaseQoSProof(taskId, 'verifier1');
    const proof2 = generateBaseQoSProof(taskId, 'verifier2');

    // 设置较长的测试超时时间
    jest.setTimeout(15000);

    // 1. Leader收到所有证明
    leaderNode.handleQoSProof(proof1);
    await new Promise(resolve => setTimeout(resolve, 100));
    leaderNode.handleQoSProof(proof2);

    // 等待一段时间，让Leader启动共识
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Follower1收到所有证明
    followerNode1.handleQoSProof(proof1);
    await new Promise(resolve => setTimeout(resolve, 100));
    followerNode1.handleQoSProof(proof2);

    // 3. Follower2只收到一个证明
    await new Promise(resolve => setTimeout(resolve, 1000));
    followerNode2.handleQoSProof(proof1);

    // 4. Follower3也只收到一个证明
    await new Promise(resolve => setTimeout(resolve, 1000));
    followerNode3.handleQoSProof(proof2);

    // 等待一段时间
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 检查共识是否达成
    // 由于系统要求每个节点必须拥有至少2个proof才能参与共识，
    // 所以在这种情况下应该无法达成共识

    // 验证任务状态 - 由于两个follower没有足够证明，预期共识无法达成
    const currentStatus = leaderNode.getTaskStatus(taskId);

    // 验证任务状态
    expect(currentStatus).not.toBeNull();
    expect(currentStatus!.state).toBe(TaskProcessingState.Consensus);

    // 确认任务未进入完成状态
    const finalStatus = await waitForTaskState(
      leaderNode,
      taskId,
      TaskProcessingState.Finalized,
      3000 // 短超时时间，因为我们预期不会进入此状态
    );
    expect(finalStatus).toBeNull();

    // 验证各节点状态
    expect(leaderNode.getTaskStatus(taskId)!.state).toBe(TaskProcessingState.Consensus);
    expect(followerNode1.getTaskStatus(taskId)!.state).toBe(TaskProcessingState.Consensus);

    // follower2和follower3应该无法完全参与共识过程
    const follower2Status = followerNode2.getTaskStatus(taskId);
    const follower3Status = followerNode3.getTaskStatus(taskId);

    // 他们可能已经收到任务，但无法完成共识
    if (follower2Status) {
      expect(follower2Status.state).not.toBe(TaskProcessingState.Finalized);
    }

    if (follower3Status) {
      expect(follower3Status.state).not.toBe(TaskProcessingState.Finalized);
    }
  });
});
