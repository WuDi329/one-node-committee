// src/service/NodeManager.ts

import { CommitteeNode } from '../core/CommitteeNode';
import { ApiServer } from '../network/ApiServer';
import { QoSProof, TaskStatus } from '../models/types';
import axios from 'axios';
import { logger } from '../utils/logger';

export class NodeManager {
  private nodes: Map<
    string,
    {
      committeeNode: CommitteeNode;
      apiServer: ApiServer;
      port: number;
    }
  > = new Map();

  // 获取所有节点ID
  public getAllNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  // 获取网络状态
  public getNodesStatus(): any[] {
    const status = [];
    for (const [nodeId, node] of this.nodes.entries()) {
      status.push({
        id: nodeId,
        port: node.port,
        apiPort: node.port + 1000,
        isLeader: nodeId === 'leader',
        status: node.committeeNode.getStatus(),
      });
    }
    return status;
  }

  // 获取节点数量
  public getNodesCount(): number {
    return this.nodes.size;
  }

  // 从测试代码中提取的启动节点方法
  async startNodes(leaderPort: number, followerPorts: number[], totalNodes: number): Promise<void> {
    logger.info(`正在启动PBFT模拟网络: 1个Leader节点和${followerPorts.length}个Follower节点`);

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
    logger.info(`PBFT模拟网络启动完成，共${this.nodes.size}个节点`);
  }

  async stopNodes(): Promise<void> {
    logger.info(`正在停止PBFT模拟网络，共${this.nodes.size}个节点`);
    for (const [nodeId, { committeeNode, apiServer }] of this.nodes.entries()) {
      logger.debug(`正在停止节点: ${nodeId}`);
      await apiServer.stop();
      committeeNode.stop();
    }
    this.nodes.clear();
    logger.info('PBFT模拟网络已停止');
  }

  async submitProof(nodeId: string, proof: QoSProof): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);

    const apiPort = node.port + 1000;
    await axios.post(`http://localhost:${apiPort}/proof`, proof);
  }

  async submitSupplementaryProof(nodeId: string, taskId: string, proof: QoSProof): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);

    const apiPort = node.port + 1000;
    await axios.post(`http://localhost:${apiPort}/proof/${taskId}/supplementary`, proof);
  }

  async getTaskStatus(nodeId: string, taskId: string): Promise<TaskStatus> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);

    const apiPort = node.port + 1000;
    const response = await axios.get(`http://localhost:${apiPort}/proof/${taskId}/status`);
    return response.data;
  }

  getCommitteeNode(nodeId: string): CommitteeNode | undefined {
    return this.nodes.get(nodeId)?.committeeNode;
  }
}
