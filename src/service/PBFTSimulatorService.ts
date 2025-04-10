// src/service/PBFTSimulatorService.ts

import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { NodeManager } from './NodeManager';
import { MetricsCollector } from './MetricsCollector';
import { QoSProof, TaskProcessingState } from '../models/types';
import { logger } from '../utils/logger';
import { GlobalMetricsCollector } from './GlobalMetricsCollector';
import { generateTestProof, generateConflictingProof } from '../utils/proof-utils';

export class PBFTSimulatorService {
  private app: express.Application;
  private port: number;
  private server?: any;
  private nodeManager: NodeManager;
  private metricsCollector: MetricsCollector;
  private isRunning: boolean = false;
  private defaultConfig = {
    basePort: 8000,
    // followerPorts: [8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008, 8009],
    defaultTotalNodes: 10,
  };
  // private defaultConfig = {
  //   leaderPort: 8000,
  //   followerPorts: [8001, 8002, 8003],
  //   totalNodes: 4,
  // };

  constructor(port: number) {
    this.port = port;
    this.app = express();
    this.nodeManager = new NodeManager();
    this.metricsCollector = new MetricsCollector();

    // 配置中间件
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: '10mb' }));

    // 设置路由
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', isRunning: this.isRunning });
    });

    // 启动模拟网络
    this.app.post('/simulator/start', async (req: Request, res: Response): Promise<void> => {
      try {
        if (this.isRunning) {
          res.status(400).json({
            error: '模拟器已经在运行中',
          });
        }

        // 只需要指定节点总数，其他配置自动生成
        const {
          totalNodes = this.defaultConfig.defaultTotalNodes,
          basePort = this.defaultConfig.basePort,
        } = req.body;

        // 生成端口配置
        const leaderPort = basePort;
        const followerPorts = [];

        // 生成follower端口（从basePort+1开始）
        for (let i = 1; i < totalNodes; i++) {
          followerPorts.push(basePort + i);
        }

        await this.startSimulator(leaderPort, followerPorts, totalNodes);

        res.status(200).json({
          status: 'success',
          message: '模拟网络已启动',
          config: {
            leaderPort,
            followerPorts,
            totalNodes,
          },
        });
      } catch (error) {
        logger.error(`启动模拟网络失败: ${error}`);
        res.status(500).json({
          error: '启动模拟网络失败',
          message: (error as Error).message,
        });
      }
    });

    // 停止模拟网络
    this.app.post('/simulator/stop', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.isRunning) {
          res.status(400).json({
            error: '模拟器未运行',
          });
        }

        await this.stopSimulator();

        res.status(200).json({
          status: 'success',
          message: '模拟网络已停止',
        });
      } catch (error) {
        logger.error(`停止模拟网络失败: ${error}`);
        res.status(500).json({
          error: '停止模拟网络失败',
          message: (error as Error).message,
        });
      }
    });

    // 提交测试任务
    this.app.post('/simulator/task', async (req, res): Promise<void> => {
      try {
        const { taskType, customTaskId } = req.body;

        if (!this.isRunning) {
          res.status(400).json({
            error: '模拟器未运行',
          });
        }

        if (!['normal', 'conflict'].includes(taskType)) {
          res.status(400).json({
            error: '无效的任务类型',
            message: '支持的任务类型: normal, conflict',
          });
        }

        const result = await this.runTestTask(taskType, customTaskId);
        res.status(200).json(result);
      } catch (error) {
        logger.error(`执行测试任务失败: ${error}`);
        res.status(500).json({
          error: '执行测试任务失败',
          message: (error as Error).message,
        });
      }
    });

    // 获取模拟器状态
    this.app.get('/simulator/status', (req, res) => {
      try {
        const status = {
          isRunning: this.isRunning,
          nodesCount: this.isRunning ? this.nodeManager.getNodesCount() : 0,
          nodes: this.isRunning ? this.nodeManager.getNodesStatus() : [],
        };

        res.status(200).json(status);
      } catch (error) {
        logger.error(`获取模拟器状态失败: ${error}`);
        res.status(500).json({
          error: '获取模拟器状态失败',
          message: (error as Error).message,
        });
      }
    });

    // 获取性能指标 - 系统级别
    this.app.get('/simulator/metrics/system', (req, res) => {
      try {
        const metrics = this.metricsCollector.getSystemMetrics();
        res.status(200).json(metrics);
      } catch (error) {
        logger.error(`获取系统指标失败: ${error}`);
        res.status(500).json({
          error: '获取系统指标失败',
          message: (error as Error).message,
        });
      }
    });

    // 获取性能指标 - 任务级别
    this.app.get('/simulator/metrics/tasks', (req, res): void => {
      try {
        const { taskId } = req.query;

        if (taskId) {
          const metrics = this.metricsCollector.getTaskMetrics(taskId as string);
          if (!metrics) {
            res.status(404).json({
              error: '任务不存在',
              message: `找不到任务ID: ${taskId}`,
            });
          }

          res.status(200).json(metrics);
        } else {
          const metrics = this.metricsCollector.getAllTaskMetrics();
          res.status(200).json(metrics);
        }
      } catch (error) {
        logger.error(`获取任务指标失败: ${error}`);
        res.status(500).json({
          error: '获取任务指标失败',
          message: (error as Error).message,
        });
      }
    });

    // 获取所有指标
    this.app.get('/simulator/metrics', (req, res) => {
      try {
        const metrics = this.metricsCollector.getAllMetrics();
        res.status(200).json(metrics);
      } catch (error) {
        logger.error(`获取指标失败: ${error}`);
        res.status(500).json({
          error: '获取指标失败',
          message: (error as Error).message,
        });
      }
    });

    // 清除指标
    this.app.delete('/simulator/metrics', (req, res): void => {
      try {
        const { taskId } = req.query;

        if (taskId) {
          const result = this.metricsCollector.clearTaskMetrics(taskId as string);
          if (!result) {
            res.status(404).json({
              error: '任务不存在',
              message: `找不到任务ID: ${taskId}`,
            });
          }

          res.status(200).json({
            status: 'success',
            message: `已清除任务 ${taskId} 的指标`,
          });
        } else {
          this.metricsCollector.clearAllMetrics();
          res.status(200).json({
            status: 'success',
            message: '已清除所有指标',
          });
        }
      } catch (error) {
        logger.error(`清除指标失败: ${error}`);
        res.status(500).json({
          error: '清除指标失败',
          message: (error as Error).message,
        });
      }
    });

    // 在 PBFTSimulatorService 的 setupRoutes 方法中添加
    // 获取事件数据
    this.app.get('/simulator/events', (req, res) => {
      try {
        const { taskId, nodeId, eventType, startTime, endTime } = req.query;
        const collector = GlobalMetricsCollector.getInstance();

        let events = [];

        if (taskId) {
          events = collector.getTaskEvents(taskId as string);
        } else if (nodeId) {
          events = collector.getNodeEvents(nodeId as string);
        } else {
          events = collector.getAllEvents();
        }

        // 应用过滤条件
        if (eventType) {
          events = events.filter(e => e.eventType === eventType);
        }

        if (startTime) {
          events = events.filter(e => e.timestamp >= Number(startTime));
        }

        if (endTime) {
          events = events.filter(e => e.timestamp <= Number(endTime));
        }

        res.status(200).json(events);
      } catch (error) {
        logger.error(`获取事件数据失败: ${error}`);
        res.status(500).json({
          error: '获取事件数据失败',
          message: (error as Error).message,
        });
      }
    });
  }

  private async startSimulator(
    leaderPort: number,
    followerPorts: number[],
    totalNodes: number
  ): Promise<void> {
    await this.nodeManager.startNodes(leaderPort, followerPorts, totalNodes);
    this.isRunning = true;
    logger.info('PBFT模拟器启动成功');
  }

  private async stopSimulator(): Promise<void> {
    await this.nodeManager.stopNodes();
    this.isRunning = false;
    logger.info('PBFT模拟器已停止');
  }

  // 执行测试任务
  private async runTestTask(taskType: string, customTaskId?: string): Promise<any> {
    const taskId = customTaskId || `task-${Date.now()}`;

    // 开始记录指标
    // this.metricsCollector.startTaskMetrics(taskId, taskType);

    try {
      let result;

      if (taskType === 'normal') {
        // 执行正常共识测试
        result = await this.runNormalConsensusTest(taskId);
      } else if (taskType === 'conflict') {
        // 执行冲突解决测试
        result = await this.runConflictResolutionTest(taskId);
      } else {
        throw new Error(`不支持的任务类型: ${taskType}`);
      }

      return {
        taskId,
        taskType,
        status: 'completed',
        result,
      };
    } catch (error) {
      // 记录失败
      // this.metricsCollector.failTaskMetrics(taskId, (error as Error).message);

      throw error;
    }
  }

  // 正常共识测试
  private async runNormalConsensusTest(taskId: string): Promise<any> {
    const timePoints: Record<string, number> = {
      start: Date.now(),
    };

    // 生成测试证明
    const proof1 = generateTestProof(taskId, 'verifier1');
    const proof2 = generateTestProof(taskId, 'verifier2');

    // 获取所有节点ID
    const nodeIds = this.nodeManager.getAllNodeIds();

    // 向所有节点提交证明，不再硬编码节点名称
    for (const nodeId of nodeIds) {
      await this.nodeManager.submitProof(nodeId, proof1);
      await this.nodeManager.submitProof(nodeId, proof2);
      timePoints[`${nodeId}Submitted`] = Date.now();
    }

    // // 提交证明到Leader节点
    // await this.nodeManager.submitProof('leader', proof1);
    // await this.nodeManager.submitProof('leader', proof2);
    // timePoints.leaderSubmitted = Date.now();

    // // 提交证明到Follower节点
    // await this.nodeManager.submitProof('follower1', proof1);
    // await this.nodeManager.submitProof('follower1', proof2);
    // timePoints.follower1Submitted = Date.now();

    // await this.nodeManager.submitProof('follower2', proof1);
    // await this.nodeManager.submitProof('follower2', proof2);
    // timePoints.follower2Submitted = Date.now();

    // await this.nodeManager.submitProof('follower3', proof1);
    // await this.nodeManager.submitProof('follower3', proof2);
    // timePoints.follower3Submitted = Date.now();

    // 等待共识开始
    const consensusStartTime = Date.now();
    timePoints.consensusStart = consensusStartTime;

    // 等待任务进入最终状态
    await this.waitForTaskState(taskId, TaskProcessingState.Finalized, 10000);

    // 共识结束
    const consensusEndTime = Date.now();
    timePoints.consensusEnd = consensusEndTime;

    // 获取最终状态
    const finalStatus = await this.nodeManager.getTaskStatus('leader', taskId);

    const endTime = Date.now();
    timePoints.end = endTime;

    return {
      finalStatus,
      timePoints,
      performanceMetrics: {
        totalDuration: endTime - timePoints.start,
        submissionPhase: timePoints[`${nodeIds[nodeIds.length - 1]}Submitted`] - timePoints.start,
        consensusPhase: timePoints.consensusEnd - timePoints.consensusStart,
        validationPhase: endTime - timePoints.consensusEnd,
      },
    };
  }

  // 冲突解决测试
  private async runConflictResolutionTest(taskId: string): Promise<any> {
    const timePoints: Record<string, number> = {
      start: Date.now(),
    };

    // 生成冲突证明
    const proof1 = generateTestProof(taskId, 'verifier1');
    const proof2 = generateConflictingProof(taskId, 'verifier2', 'codec');

    // 获取所有节点ID
    const nodeIds = this.nodeManager.getAllNodeIds();
    const leaderNode = nodeIds.find(id => id === 'leader') || nodeIds[0];
    const followerNodes = nodeIds.filter(id => id !== leaderNode);

    // 向所有节点提交proof2，制造冲突
    for (const nodeId of nodeIds) {
      await this.nodeManager.submitProof(nodeId, proof1);
      timePoints[`${nodeId}Proof1Submitted`] = Date.now();
    }

    // 向所有节点提交proof2，制造冲突
    for (const nodeId of nodeIds) {
      await this.nodeManager.submitProof(nodeId, proof2);
      timePoints[`${nodeId}Proof2Submitted`] = Date.now();
    }

    // 等待进入等待补充验证状态
    await this.waitForTaskState(taskId, TaskProcessingState.AwaitingSupplementary, 10000);
    timePoints.awaitingSupplementary = Date.now();

    // 生成并提交补充证明
    const supplementaryProof = generateTestProof(taskId, 'verifier3');
    supplementaryProof.mediaSpecs.codec = proof1.mediaSpecs.codec; // 与第一个一致

    // 向所有节点提交补充证明
    for (const nodeId of nodeIds) {
      await this.nodeManager.submitSupplementaryProof(nodeId, taskId, supplementaryProof);
      timePoints[`${nodeId}SupplementarySubmitted`] = Date.now();
    }

    // 等待最终共识
    await this.waitForTaskState(taskId, TaskProcessingState.Finalized, 15000);
    timePoints.finalized = Date.now();

    // 获取最终状态
    const finalStatus = await this.nodeManager.getTaskStatus(leaderNode, taskId);

    const endTime = Date.now();
    timePoints.end = endTime;

    return {
      finalStatus,
      timePoints,
      performanceMetrics: {
        totalDuration: endTime - timePoints.start,
        conflictDetectionPhase: timePoints.awaitingSupplementary - timePoints.start,
        supplementaryPhase: timePoints.finalized - timePoints.awaitingSupplementary,
        totalConsensusDuration: timePoints.finalized - timePoints.start,
      },
    };
  }

  // 等待任务状态
  private async waitForTaskState(
    taskId: string,
    expectedState: TaskProcessingState,
    timeout: number
  ): Promise<void> {
    const startTime = Date.now();
    let lastState = '';

    // 创建状态映射
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

        if (status.state !== lastState) {
          logger.debug(`任务 ${taskId} 状态改变为: ${status.state}`);
          lastState = status.state;
        }

        // 比较API返回的状态字符串与预期状态字符串
        if (status.state === expectedStateStr) {
          return;
        }
      } catch (error) {
        // 忽略错误，可能是任务状态尚未创建
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`等待任务 ${taskId} 达到状态 ${expectedState} 超时`);
  }

  // 启动服务
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`PBFT模拟服务已在端口 ${this.port} 上启动`);
          resolve();
        });
      } catch (error) {
        logger.error(`启动服务失败: ${error}`);
        reject(error);
      }
    });
  }

  // 停止服务
  public async stop(): Promise<void> {
    // 先停止模拟网络
    if (this.isRunning) {
      try {
        await this.stopSimulator();
      } catch (error) {
        logger.error(`停止模拟网络失败: ${error}`);
      }
    }

    // 再停止HTTP服务器
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err: Error) => {
        if (err) {
          logger.error(`关闭HTTP服务器失败: ${err}`);
          reject(err);
        } else {
          logger.info('PBFT模拟服务已停止');
          this.server = undefined;
          resolve();
        }
      });
    });
  }
}
