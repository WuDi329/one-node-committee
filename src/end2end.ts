import { CommitteeNode } from './core/CommitteeNode';
import { ApiServer } from './network/ApiServer';
import { QoSProof, TaskProcessingState, TaskStatus } from './models/types';
import axios from 'axios';
// import { generateTestProof, generateConflictingProof } from './test-utils';

class NodeManager {
  private nodes: Map<
    string,
    {
      committeeNode: CommitteeNode;
      apiServer: ApiServer;
      port: number;
    }
  > = new Map();

  async startNodes(leaderPort: number, followerPorts: number[], totalNodes: number): Promise<void> {
    // 启动Leader节点
    const leaderNodeId = 'leader';
    const peers = followerPorts.map((port, index) => `follower${index + 1}:localhost:${port}`);

    const leaderNode = new CommitteeNode(leaderNodeId, leaderPort, true, peers, totalNodes);
    const leaderApi = new ApiServer(leaderPort + 1000, leaderNode); // API端口 = 节点端口 + 1000

    leaderNode.start();
    await leaderApi.start();

    this.nodes.set(leaderNodeId, {
      committeeNode: leaderNode,
      apiServer: leaderApi,
      port: leaderPort,
    });

    // 启动Follower节点
    for (let i = 0; i < followerPorts.length; i++) {
      const nodeId = `follower${i + 1}`;
      const port = followerPorts[i];
      const nodePeers = [
        `leader:localhost:${leaderPort}`,
        ...followerPorts
          .filter(p => p !== port)
          .map((p, j) => {
            const idx = followerPorts.indexOf(p) + 1;
            return `follower${idx}:localhost:${p}`;
          }),
      ];

      const node = new CommitteeNode(nodeId, port, false, nodePeers, totalNodes);
      const api = new ApiServer(port + 1000, node);

      node.start();
      await api.start();

      this.nodes.set(nodeId, { committeeNode: node, apiServer: api, port });
    }

    // 等待网络连接稳定
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  async stopNodes(): Promise<void> {
    for (const [nodeId, { committeeNode, apiServer }] of this.nodes.entries()) {
      await apiServer.stop();
      committeeNode.stop();
    }
    this.nodes.clear();
  }

  async submitProof(nodeId: string, proof: QoSProof): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const apiPort = node.port + 1000;
    await axios.post(`http://localhost:${apiPort}/proof`, proof);
  }

  async submitSupplementaryProof(nodeId: string, taskId: string, proof: QoSProof): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const apiPort = node.port + 1000;
    await axios.post(`http://localhost:${apiPort}/proof/${taskId}/supplementary`, proof);
  }

  async getTaskStatus(nodeId: string, taskId: string): Promise<TaskStatus> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const apiPort = node.port + 1000;
    const response = await axios.get(`http://localhost:${apiPort}/proof/${taskId}/status`);
    return response.data;
  }

  getCommitteeNode(nodeId: string): CommitteeNode | undefined {
    return this.nodes.get(nodeId)?.committeeNode;
  }
}

class TestRunner {
  private nodeManager: NodeManager;

  constructor() {
    this.nodeManager = new NodeManager();
  }

  async setup(): Promise<void> {
    const leaderPort = 8000;
    const followerPorts = [8001, 8002, 8003];
    const totalNodes = followerPorts.length + 1;

    await this.nodeManager.startNodes(leaderPort, followerPorts, totalNodes);
    console.log('Test network started successfully');
  }

  async teardown(): Promise<void> {
    await this.nodeManager.stopNodes();
    console.log('Test network stopped');
  }

  // async runNormalConsensusTest(): Promise<void> {
  //   console.log('\n=== Running Normal Consensus Test ===');

  //   const startTime = Date.now();

  //   // 生成测试证明
  //   const taskId = `task-${Date.now()}`;
  //   const proof1 = generateTestProof(taskId, 'verifier1');
  //   const proof2 = generateTestProof(taskId, 'verifier2');

  //   // 记录各个节点处理的时间点
  //   const timePoints: Record<string, number> = {
  //     start: startTime,
  //   };

  //   // 提交证明到Leader和Follower节点
  //   await this.nodeManager.submitProof('leader', proof1);
  //   console.log(`Submitted proof from verifier1 to leader for task ${taskId}`);
  //   await this.nodeManager.submitProof('leader', proof2);
  //   console.log(`Submitted proof from verifier2 to leader for task ${taskId}`);
  //   timePoints.leaderSubmitted = Date.now();

  //   // 等待验证处理
  //   // await new Promise(resolve => setTimeout(resolve, 1000));

  //   await this.nodeManager.submitProof('follower1', proof1);
  //   console.log(`Submitted proof from verifier1 to follower1 for task ${taskId}`);
  //   await this.nodeManager.submitProof('follower1', proof2);
  //   console.log(`Submitted proof from verifier2 to follower1 for task ${taskId}`);
  //   timePoints.follower1Submitted = Date.now();

  //   // 等待验证处理
  //   // await new Promise(resolve => setTimeout(resolve, 1000));

  //   await this.nodeManager.submitProof('follower2', proof1);
  //   console.log(`Submitted proof from verifier1 to follower2 for task ${taskId}`);
  //   await this.nodeManager.submitProof('follower2', proof2);
  //   console.log(`Submitted proof from verifier2 to follower2 for task ${taskId}`);
  //   timePoints.follower2Submitted = Date.now();

  //   // 等待验证处理
  //   // await new Promise(resolve => setTimeout(resolve, 1000));

  //   await this.nodeManager.submitProof('follower3', proof1);
  //   console.log(`Submitted proof from verifier1 to follower3 for task ${taskId}`);
  //   await this.nodeManager.submitProof('follower3', proof2);
  //   console.log(`Submitted proof from verifier2 to follower3 for task ${taskId}`);
  //   timePoints.follower3Submitted = Date.now();

  //   // 等待共识过程完成 - 这个超时需要保留，但可以缩短
  //   const consensusStartTime = Date.now();

  //   timePoints.consensusStart = consensusStartTime;

  //   await this.waitForTaskState(taskId, TaskProcessingState.Finalized, 10000);

  //   // 计算共识完成的时间
  //   const consensusEndTime = Date.now();
  //   timePoints.consensusEnd = consensusEndTime;

  //   // 验证最终结果
  //   const finalStatus = await this.nodeManager.getTaskStatus('leader', taskId);
  //   console.log(`Final task status: ${JSON.stringify(finalStatus, null, 2)}`);

  //   const endTime = Date.now();
  //   timePoints.end = endTime;

  //   console.log('\n=== 性能测量结果 ===');
  //   console.log(`总耗时: ${endTime - startTime}ms`);
  //   console.log(`证明提交阶段: ${timePoints.follower3Submitted - startTime}ms`);
  //   console.log(`共识阶段: ${timePoints.consensusEnd - timePoints.consensusStart}ms`);
  //   console.log(`验证结果阶段: ${endTime - timePoints.consensusEnd}ms`);

  //   // 各节点提交耗时
  //   console.log(`Leader提交耗时: ${timePoints.leaderSubmitted - startTime}ms`);
  //   console.log(
  //     `Follower1提交耗时: ${timePoints.follower1Submitted - timePoints.leaderSubmitted}ms`
  //   );
  //   console.log(
  //     `Follower2提交耗时: ${timePoints.follower2Submitted - timePoints.follower1Submitted}ms`
  //   );
  //   console.log(
  //     `Follower3提交耗时: ${timePoints.follower3Submitted - timePoints.follower2Submitted}ms`
  //   );

  //   // 输出详细时间点记录
  //   console.log('各时间点记录:');
  //   Object.entries(timePoints).forEach(([key, value]) => {
  //     console.log(`${key}: ${value}ms (相对开始: +${value - startTime}ms)`);
  //   });
  // }

  async run2NormalConsensusTest(): Promise<void> {
    console.log('\n=== Running 2 Normal Consensus Test ===');

    const startTime = Date.now();

    // 生成测试证明
    const taskId = `task-${Date.now()}`;
    const proof1 = generateTestProof(taskId, 'verifier1');
    const proof2 = generateTestProof(taskId, 'verifier2');

    // 记录各个节点处理的时间点
    const timePoints1: Record<string, number> = {
      start: startTime,
    };

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof1);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId}`);
    await this.nodeManager.submitProof('leader', proof2);
    console.log(`Submitted proof from verifier2 to leader for task ${taskId}`);
    timePoints1.leaderSubmitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower1', proof1);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId}`);
    await this.nodeManager.submitProof('follower1', proof2);
    console.log(`Submitted proof from verifier2 to follower1 for task ${taskId}`);
    timePoints1.follower1Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof1);
    console.log(`Submitted proof from verifier1 to follower2 for task ${taskId}`);
    await this.nodeManager.submitProof('follower2', proof2);
    console.log(`Submitted proof from verifier2 to follower2 for task ${taskId}`);
    timePoints1.follower2Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower3', proof1);
    console.log(`Submitted proof from verifier1 to follower3 for task ${taskId}`);
    await this.nodeManager.submitProof('follower3', proof2);
    console.log(`Submitted proof from verifier2 to follower3 for task ${taskId}`);
    timePoints1.follower3Submitted = Date.now();

    // 等待共识过程完成 - 这个超时需要保留，但可以缩短
    const consensusStartTime = Date.now();

    timePoints1.consensusStart = consensusStartTime;

    await this.waitForTaskState(taskId, TaskProcessingState.Finalized, 10000);

    // 计算共识完成的时间
    const consensusEndTime = Date.now();
    timePoints1.consensusEnd = consensusEndTime;

    // 验证最终结果
    const finalStatus = await this.nodeManager.getTaskStatus('leader', taskId);
    console.log(`Final task status: ${JSON.stringify(finalStatus, null, 2)}`);

    const endTime = Date.now();
    timePoints1.end = endTime;

    console.log('\n=== 性能测量结果 ===');
    console.log(`总耗时: ${endTime - startTime}ms`);
    console.log(`证明提交阶段: ${timePoints1.follower3Submitted - startTime}ms`);
    console.log(`共识阶段: ${timePoints1.consensusEnd - timePoints1.consensusStart}ms`);
    console.log(`验证结果阶段: ${endTime - timePoints1.consensusEnd}ms`);

    // 各节点提交耗时
    console.log(`Leader提交耗时: ${timePoints1.leaderSubmitted - startTime}ms`);
    console.log(
      `Follower1提交耗时: ${timePoints1.follower1Submitted - timePoints1.leaderSubmitted}ms`
    );
    console.log(
      `Follower2提交耗时: ${timePoints1.follower2Submitted - timePoints1.follower1Submitted}ms`
    );
    console.log(
      `Follower3提交耗时: ${timePoints1.follower3Submitted - timePoints1.follower2Submitted}ms`
    );

    // 输出详细时间点记录
    console.log('各时间点记录:');
    Object.entries(timePoints1).forEach(([key, value]) => {
      console.log(`${key}: ${value}ms (相对开始: +${value - startTime}ms)`);
    });

    console.log(
      '\n========================= Running 2 Normal Consensus Test second test ======================'
    );

    const startTime2 = Date.now();

    const taskId2 = `task-${Date.now()}`;
    const proof3 = generateTestProof(taskId2, 'verifier1');
    const proof4 = generateTestProof(taskId2, 'verifier2');

    // 记录各个节点处理的时间点
    const timePoints2: Record<string, number> = {
      start: startTime2,
    };

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof3);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId2}`);
    await this.nodeManager.submitProof('leader', proof4);
    console.log(`Submitted proof from verifier2 to leader for task ${taskId2}`);
    timePoints2.leaderSubmitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower1', proof3);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower1', proof4);
    console.log(`Submitted proof from verifier2 to follower1 for task ${taskId2}`);
    timePoints2.follower1Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof3);
    console.log(`Submitted proof from verifier1 to follower2 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower2', proof4);
    console.log(`Submitted proof from verifier2 to follower2 for task ${taskId2}`);
    timePoints2.follower2Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower3', proof3);
    console.log(`Submitted proof from verifier1 to follower3 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower3', proof4);
    console.log(`Submitted proof from verifier2 to follower3 for task ${taskId2}`);
    timePoints2.follower3Submitted = Date.now();

    // 等待共识过程完成 - 这个超时需要保留，但可以缩短
    const consensusStartTime2 = Date.now();

    timePoints2.consensusStart = consensusStartTime2;

    await this.waitForTaskState(taskId2, TaskProcessingState.Finalized, 10000);

    // 计算共识完成的时间
    const consensusEndTime2 = Date.now();
    timePoints2.consensusEnd = consensusEndTime2;

    // 验证最终结果
    const finalStatus2 = await this.nodeManager.getTaskStatus('leader', taskId2);
    console.log(`Final task status: ${JSON.stringify(finalStatus2, null, 2)}`);

    const endTime2 = Date.now();
    timePoints2.end = endTime2;

    console.log('\n=== 性能测量结果 ===');
    console.log(`总耗时: ${endTime2 - startTime2}ms`);
    console.log(`证明提交阶段: ${timePoints2.follower3Submitted - startTime}ms`);
    console.log(`共识阶段: ${timePoints1.consensusEnd - timePoints1.consensusStart}ms`);
    console.log(`验证结果阶段: ${endTime - timePoints1.consensusEnd}ms`);

    // 各节点提交耗时
    console.log(`Leader提交耗时: ${timePoints1.leaderSubmitted - startTime}ms`);
    console.log(
      `Follower1提交耗时: ${timePoints1.follower1Submitted - timePoints1.leaderSubmitted}ms`
    );
    console.log(
      `Follower2提交耗时: ${timePoints1.follower2Submitted - timePoints1.follower1Submitted}ms`
    );
    console.log(
      `Follower3提交耗时: ${timePoints1.follower3Submitted - timePoints1.follower2Submitted}ms`
    );

    // 输出详细时间点记录
    console.log('各时间点记录:');
    Object.entries(timePoints1).forEach(([key, value]) => {
      console.log(`${key}: ${value}ms (相对开始: +${value - startTime}ms)`);
    });
  }

  async runConflictResolutionTest(): Promise<void> {
    console.log('\n=== Running Conflict Resolution Test ===');

    // 生成带有冲突的测试证明
    const taskId0 = `conflict-task-${Date.now()}`;
    const proof01 = generateTestProof(taskId0, 'verifier1');
    const proof02 = generateConflictingProof(taskId0, 'verifier2', 'codec');

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof01);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId0}`);

    await this.nodeManager.submitProof('follower1', proof01);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId0}`);

    // 等待验证处理
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 提交冲突证明触发冲突处理
    await this.nodeManager.submitProof('leader', proof02);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId0}`);

    await this.nodeManager.submitProof('follower1', proof02);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId0}`);

    // 等待验证处理
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof02);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId0}`);

    await this.nodeManager.submitProof('follower3', proof02);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId0}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof01);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId0}`);

    await this.nodeManager.submitProof('follower3', proof01);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId0}`);

    // 等待进入等待补充验证状态
    await this.waitForTaskState(taskId0, TaskProcessingState.AwaitingSupplementary, 10000);
    console.log('Task entered awaiting supplementary state');

    // 生成并提交补充证明
    const supplementaryProof = generateTestProof(taskId0, 'verifier3');
    supplementaryProof.mediaSpecs.codec = proof01.mediaSpecs.codec; // 与第一个一致

    // 使用新的提交补充证明方法
    await this.nodeManager.submitSupplementaryProof('leader', taskId0, supplementaryProof);
    console.log(`Submitted supplementary proof to resolve conflict for task ${taskId0}`);

    await this.nodeManager.submitSupplementaryProof('follower1', taskId0, supplementaryProof);
    console.log(
      `Submitted supplementary proof to follower1 to resolve conflict for task ${taskId0}`
    );

    await this.nodeManager.submitSupplementaryProof('follower2', taskId0, supplementaryProof);
    console.log(
      `Submitted supplementary proof to follower2 to resolve conflict for task ${taskId0}`
    );

    await this.nodeManager.submitSupplementaryProof('follower3', taskId0, supplementaryProof);
    console.log(
      `Submitted supplementary proof to follower3 to resolve conflict for task ${taskId0}`
    );

    // 等待最终共识完成
    await this.waitForTaskState(taskId0, TaskProcessingState.Finalized, 15000);

    // 验证最终结果
    const finalStatus0 = await this.nodeManager.getTaskStatus('leader', taskId0);
    console.log(
      `Final task status after conflict resolution: ${JSON.stringify(finalStatus0, null, 2)}`
    );

    console.log('\n=== Running 2 Normal Consensus Test ===');

    const startTime = Date.now();

    // 生成测试证明
    const taskId = `task-${Date.now()}`;
    const proof1 = generateTestProof(taskId, 'verifier1');
    const proof2 = generateTestProof(taskId, 'verifier2');

    // 记录各个节点处理的时间点
    const timePoints1: Record<string, number> = {
      start: startTime,
    };

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof1);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId}`);
    await this.nodeManager.submitProof('leader', proof2);
    console.log(`Submitted proof from verifier2 to leader for task ${taskId}`);
    timePoints1.leaderSubmitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower1', proof1);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId}`);
    await this.nodeManager.submitProof('follower1', proof2);
    console.log(`Submitted proof from verifier2 to follower1 for task ${taskId}`);
    timePoints1.follower1Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof1);
    console.log(`Submitted proof from verifier1 to follower2 for task ${taskId}`);
    await this.nodeManager.submitProof('follower2', proof2);
    console.log(`Submitted proof from verifier2 to follower2 for task ${taskId}`);
    timePoints1.follower2Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower3', proof1);
    console.log(`Submitted proof from verifier1 to follower3 for task ${taskId}`);
    await this.nodeManager.submitProof('follower3', proof2);
    console.log(`Submitted proof from verifier2 to follower3 for task ${taskId}`);
    timePoints1.follower3Submitted = Date.now();

    // 等待共识过程完成 - 这个超时需要保留，但可以缩短
    const consensusStartTime = Date.now();

    timePoints1.consensusStart = consensusStartTime;

    await this.waitForTaskState(taskId, TaskProcessingState.Finalized, 10000);

    // 计算共识完成的时间
    const consensusEndTime = Date.now();
    timePoints1.consensusEnd = consensusEndTime;

    // 验证最终结果
    const finalStatus = await this.nodeManager.getTaskStatus('leader', taskId);
    console.log(`Final task status: ${JSON.stringify(finalStatus, null, 2)}`);

    const endTime = Date.now();
    timePoints1.end = endTime;

    console.log('\n=== 性能测量结果 ===');
    console.log(`总耗时: ${endTime - startTime}ms`);
    console.log(`证明提交阶段: ${timePoints1.follower3Submitted - startTime}ms`);
    console.log(`共识阶段: ${timePoints1.consensusEnd - timePoints1.consensusStart}ms`);
    console.log(`验证结果阶段: ${endTime - timePoints1.consensusEnd}ms`);

    // 各节点提交耗时
    console.log(`Leader提交耗时: ${timePoints1.leaderSubmitted - startTime}ms`);
    console.log(
      `Follower1提交耗时: ${timePoints1.follower1Submitted - timePoints1.leaderSubmitted}ms`
    );
    console.log(
      `Follower2提交耗时: ${timePoints1.follower2Submitted - timePoints1.follower1Submitted}ms`
    );
    console.log(
      `Follower3提交耗时: ${timePoints1.follower3Submitted - timePoints1.follower2Submitted}ms`
    );

    // 输出详细时间点记录
    console.log('各时间点记录:');
    Object.entries(timePoints1).forEach(([key, value]) => {
      console.log(`${key}: ${value}ms (相对开始: +${value - startTime}ms)`);
    });

    console.log(
      '\n========================= Running 2 Normal Consensus Test second test ======================'
    );

    const startTime2 = Date.now();

    const taskId2 = `task-${Date.now()}`;
    const proof3 = generateTestProof(taskId2, 'verifier1');
    const proof4 = generateTestProof(taskId2, 'verifier2');

    // 记录各个节点处理的时间点
    const timePoints2: Record<string, number> = {
      start: startTime2,
    };

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof3);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId2}`);
    await this.nodeManager.submitProof('leader', proof4);
    console.log(`Submitted proof from verifier2 to leader for task ${taskId2}`);
    timePoints2.leaderSubmitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower1', proof3);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower1', proof4);
    console.log(`Submitted proof from verifier2 to follower1 for task ${taskId2}`);
    timePoints2.follower1Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof3);
    console.log(`Submitted proof from verifier1 to follower2 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower2', proof4);
    console.log(`Submitted proof from verifier2 to follower2 for task ${taskId2}`);
    timePoints2.follower2Submitted = Date.now();

    // 等待验证处理
    // await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower3', proof3);
    console.log(`Submitted proof from verifier1 to follower3 for task ${taskId2}`);
    await this.nodeManager.submitProof('follower3', proof4);
    console.log(`Submitted proof from verifier2 to follower3 for task ${taskId2}`);
    timePoints2.follower3Submitted = Date.now();

    // 等待共识过程完成 - 这个超时需要保留，但可以缩短
    const consensusStartTime2 = Date.now();

    timePoints2.consensusStart = consensusStartTime2;

    await this.waitForTaskState(taskId2, TaskProcessingState.Finalized, 10000);

    // 计算共识完成的时间
    const consensusEndTime2 = Date.now();
    timePoints2.consensusEnd = consensusEndTime2;

    // 验证最终结果
    const finalStatus2 = await this.nodeManager.getTaskStatus('leader', taskId2);
    console.log(`Final task status: ${JSON.stringify(finalStatus2, null, 2)}`);

    const endTime2 = Date.now();
    timePoints2.end = endTime2;

    console.log('\n=== 性能测量结果 ===');
    console.log(`总耗时: ${endTime2 - startTime2}ms`);
    console.log(`证明提交阶段: ${timePoints2.follower3Submitted - startTime}ms`);
    console.log(`共识阶段: ${timePoints1.consensusEnd - timePoints1.consensusStart}ms`);
    console.log(`验证结果阶段: ${endTime - timePoints1.consensusEnd}ms`);

    // 各节点提交耗时
    console.log(`Leader提交耗时: ${timePoints1.leaderSubmitted - startTime}ms`);
    console.log(
      `Follower1提交耗时: ${timePoints1.follower1Submitted - timePoints1.leaderSubmitted}ms`
    );
    console.log(
      `Follower2提交耗时: ${timePoints1.follower2Submitted - timePoints1.follower1Submitted}ms`
    );
    console.log(
      `Follower3提交耗时: ${timePoints1.follower3Submitted - timePoints1.follower2Submitted}ms`
    );

    // 输出详细时间点记录
    console.log('各时间点记录:');
    Object.entries(timePoints1).forEach(([key, value]) => {
      console.log(`${key}: ${value}ms (相对开始: +${value - startTime}ms)`);
    });

    console.log('\n=== Running Conflict Resolution Test2222222222222222222222222222222222 ===');

    // 生成带有冲突的测试证明
    const taskId3 = `conflict-task-${Date.now()}`;
    const proof31 = generateTestProof(taskId3, 'verifier1');
    const proof32 = generateConflictingProof(taskId3, 'verifier2', 'codec');

    // 提交证明到Leader和Follower节点
    await this.nodeManager.submitProof('leader', proof31);
    console.log(`Submitted proof from verifier1 to leader for task ${taskId3}`);

    await this.nodeManager.submitProof('follower1', proof31);
    console.log(`Submitted proof from verifier1 to follower1 for task ${taskId3}`);

    // 等待验证处理
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 提交冲突证明触发冲突处理
    await this.nodeManager.submitProof('leader', proof32);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId3}`);

    await this.nodeManager.submitProof('follower1', proof32);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId3}`);

    // 等待验证处理
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof32);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId3}`);

    await this.nodeManager.submitProof('follower3', proof32);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId3}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.nodeManager.submitProof('follower2', proof31);
    console.log(`Submitted conflicting proof from verifier2 to leader for task ${taskId3}`);

    await this.nodeManager.submitProof('follower3', proof31);
    console.log(`Submitted conflicting proof from verifier2 to follower1 for task ${taskId3}`);

    // 等待进入等待补充验证状态
    await this.waitForTaskState(taskId3, TaskProcessingState.AwaitingSupplementary, 10000);
    console.log('Task entered awaiting supplementary state');

    // 生成并提交补充证明
    const supplementaryProof1 = generateTestProof(taskId3, 'verifier3');
    supplementaryProof1.mediaSpecs.codec = proof31.mediaSpecs.codec; // 与第一个一致

    // 使用新的提交补充证明方法
    await this.nodeManager.submitSupplementaryProof('leader', taskId3, supplementaryProof1);
    console.log(`Submitted supplementary proof to resolve conflict for task ${taskId0}`);

    await this.nodeManager.submitSupplementaryProof('follower1', taskId3, supplementaryProof1);
    console.log(
      `Submitted supplementary proof to follower1 to resolve conflict for task ${taskId3}`
    );

    await this.nodeManager.submitSupplementaryProof('follower2', taskId3, supplementaryProof1);
    console.log(
      `Submitted supplementary proof to follower2 to resolve conflict for task ${taskId3}`
    );

    await this.nodeManager.submitSupplementaryProof('follower3', taskId3, supplementaryProof1);
    console.log(
      `Submitted supplementary proof to follower3 to resolve conflict for task ${taskId3}`
    );

    // 等待最终共识完成
    await this.waitForTaskState(taskId3, TaskProcessingState.Finalized, 15000);

    // 验证最终结果
    const finalStatus3 = await this.nodeManager.getTaskStatus('leader', taskId3);
    console.log(
      `Final task status after conflict resolution: ${JSON.stringify(finalStatus3, null, 2)}`
    );
  }

  private async waitForTaskState(
    taskId: string,
    expectedState: TaskProcessingState,
    timeout: number
  ): Promise<void> {
    const startTime = Date.now();
    let lastState = '';

    // 创建一个映射表，与API服务器的映射保持一致
    const stateMap: Record<TaskProcessingState, string> = {
      [TaskProcessingState.Pending]: 'pending',
      [TaskProcessingState.Validating]: 'validating',
      [TaskProcessingState.Verified]: 'verified',
      [TaskProcessingState.Consensus]: 'in_consensus',
      [TaskProcessingState.Conflict]: 'conflict_detected',
      [TaskProcessingState.AwaitingSupplementary]: 'awaiting_supplementary_verification',
      [TaskProcessingState.Validated]: 'validated',
      [TaskProcessingState.Finalized]: 'finalized',
      [TaskProcessingState.Rejected]: 'rejected',
      [TaskProcessingState.Failed]: 'failed',
      [TaskProcessingState.NeedsManualReview]: 'needs_manual_review',
      [TaskProcessingState.Expired]: 'expired',
    };

    // 获取预期状态的字符串表示
    const expectedStateStr = stateMap[expectedState];

    while (Date.now() - startTime < timeout) {
      try {
        const status = await this.nodeManager.getTaskStatus('leader', taskId);
        console.log(`inside waitForTaskState`);
        console.log(status);

        if (status.state !== lastState) {
          console.log(`Task ${taskId} state changed to: ${status.state}`);
          lastState = status.state;
        }

        // 直接比较API返回的状态字符串与预期状态字符串
        if (status.state === expectedStateStr) {
          return;
        }

        // if (status.state === expectedState) {
        //   return;
        // }
      } catch (error) {
        // 忽略错误，可能是任务状态尚未创建
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Timeout waiting for task ${taskId} to reach state ${expectedState}`);
  }
}

// 证明生成工具函数
function generateTestProof(taskId: string, verifierId: string): QoSProof {
  return {
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
      overallScore: 85,
      gopScores: {
        '0': '87.5',
        '1000': '86.2',
        '2000': '84.8',
      },
    },
    audioQualityData: {
      overallScore: 92,
    },
    syncQualityData: {
      offset: 0.02,
      score: 98,
    },
    signature: 'test-signature-' + verifierId,
  };
}

function generateConflictingProof(
  taskId: string,
  verifierId: string,
  conflictType: 'codec' | 'score'
): QoSProof {
  const proof = generateTestProof(taskId, verifierId);

  if (conflictType === 'codec') {
    proof.mediaSpecs.codec = 'H.265'; // 不同的编码格式
  } else if (conflictType === 'score') {
    proof.videoQualityData.overallScore = 76; // 相差超过阈值
  }

  return proof;
}

// 主函数
async function main() {
  const runner = new TestRunner();

  try {
    await runner.setup();

    // 运行正常共识测试
    // await runner.run2NormalConsensusTest();

    // 运行冲突解决测试
    await runner.runConflictResolutionTest();
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await runner.teardown();
  }
}

// 执行测试
main().catch(console.error);
