import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { CommitteeNode } from '../core/CommitteeNode';
import { QoSProof, TaskProcessingState } from '../models/types';
import { logger } from '../utils/logger';

export class ApiServer {
  private app: express.Application;
  private port: number;
  private committeeNode: CommitteeNode;
  private server?: any;

  constructor(port: number, committeeNode: CommitteeNode) {
    this.port = port;
    this.committeeNode = committeeNode;
    this.app = express();

    // 配置中间件
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: '10mb' }));

    // 设置路由
    this.setupRoutes();
  }

  private validateProof(proof: any): { isValid: boolean; message?: string } {
    // 验证必要字段
    if (!proof.taskId || !proof.verifierId) {
      return { isValid: false, message: 'Missing required fields: taskId, verifierId' };
    }

    // 验证时间戳
    if (!proof.timestamp || typeof proof.timestamp !== 'number') {
      return { isValid: false, message: 'Invalid timestamp' };
    }

    // 验证媒体规格
    if (!proof.mediaSpecs) {
      return { isValid: false, message: 'Missing mediaSpecs' };
    }

    // 验证视频质量数据
    if (!proof.videoQualityData || typeof proof.videoQualityData.overallScore !== 'number') {
      return { isValid: false, message: 'Invalid videoQualityData' };
    }

    // 验证签名
    if (!proof.signature) {
      return { isValid: false, message: 'Missing signature' };
    }

    return { isValid: true };
  }

  private setupRoutes(): void {
    // 健康检查，返回最少的数据量，证明自己还存活者，心跳
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    // 返回详细的状态信息（业务场景）
    this.app.get('/status', (req, res) => {
      res.status(200).json(this.committeeNode.getStatus());
    });

    // 匹配提交QoS证明的场景
    this.app.post('/proof', (req: express.Request, res: express.Response): void => {
      try {
        const proof = req.body;

        // 增强的验证逻辑
        const validation = this.validateProof(proof);
        if (!validation.isValid) {
          res.status(400).json({
            error: 'Invalid proof data',
            message: validation.message,
          });
          return;
        }

        logger.info(
          `${this.committeeNode.getNodeId()}的APIServer接收到任务ID ${proof.taskId} 的QoS证明提交`
        );

        // 提交到Committee节点处理
        this.committeeNode.handleQoSProof(proof as QoSProof);

        // 响应客户端
        res.status(202).json({
          message: 'QoS proof accepted for processing',
          taskId: proof.taskId,
        });
      } catch (error) {
        logger.error('处理QoS证明提交时出错:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to process QoS proof',
        });
      }
    });

    // 批量提交QoS证明
    this.app.post('/proofs/batch', (req: express.Request, res: express.Response): void => {
      try {
        const proofs = req.body;

        if (!Array.isArray(proofs) || proofs.length === 0) {
          res.status(400).json({
            error: 'Invalid request',
            message: 'Request body must be a non-empty array of QoS proofs',
          });
          return;
        }

        logger.info(`接收到批量QoS证明提交，共 ${proofs.length} 条`);

        // 处理每个证明，包含验证
        const results = proofs.map(proof => {
          try {
            const validation = this.validateProof(proof);
            if (!validation.isValid) {
              return {
                taskId: proof.taskId || 'unknown',
                status: 'rejected',
                error: validation.message,
              };
            }

            this.committeeNode.handleQoSProof(proof as QoSProof);
            return { taskId: proof.taskId, status: 'accepted' };
          } catch (error) {
            return {
              taskId: proof.taskId || 'unknown',
              status: 'failed',
              error: (error as Error).message,
            };
          }
        });

        res.status(202).json({
          message: `Batch processing started for ${proofs.length} proofs`,
          results,
        });
      } catch (error) {
        logger.error('处理批量QoS证明提交时出错:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to process batch QoS proofs',
        });
      }
    });

    // 添加补充验证接口
    this.app.post(
      '/proof/:taskId/supplementary',
      (req: express.Request, res: express.Response): void => {
        try {
          const { taskId } = req.params;
          const proof = req.body;

          // 验证
          const validation = this.validateProof(proof);
          if (!validation.isValid) {
            res.status(400).json({
              error: 'Invalid supplementary proof data',
              message: validation.message,
            });
            return;
          }

          logger.info(
            `${this.committeeNode.getNodeId()}的APIServer接收到任务ID ${taskId} 的补充QoS证明提交`
          );

          // 确保taskId一致性
          proof.taskId = taskId;

          // 提交到Committee节点处理
          this.committeeNode.handleSupplementaryProof(taskId, proof as QoSProof);

          // 响应客户端
          res.status(202).json({
            message: 'Supplementary QoS proof accepted for processing',
            taskId,
          });
        } catch (error) {
          logger.error(`处理补充QoS证明提交时出错: ${error}`);
          res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to process supplementary QoS proof',
          });
        }
      }
    );

    // 获取特定任务的处理状态 - 更新为使用真实数据
    this.app.get('/proof/:taskId/status', (req, res) => {
      try {
        const { taskId } = req.params;

        // 从CommitteeNode获取真实状态
        const status = this.committeeNode.getTaskStatus(taskId);

        if (!status) {
          res.status(404).json({
            error: 'Task not found',
            message: `No information available for task ID: ${taskId}`,
          });
          return;
        }

        // 转换为API响应格式
        const apiResponse = {
          taskId: status.taskId,
          state: this.mapStateToStatusString(status.state),
          proofCount: status.proofCount,
          verifierIds: status.verifierIds,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
          // 如果有冲突信息，添加
          conflictInfo: status.validationInfo?.conflictType
            ? {
                type: status.validationInfo.conflictType,
                details: status.validationInfo.conflictDetails,
              }
            : undefined,
          // 如果任务已完成，添加结果信息
          result: status.result || undefined,
        };

        res.status(200).json(apiResponse);
      } catch (error) {
        logger.error(`获取任务状态时出错: ${error}`);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to retrieve task status',
        });
      }
    });

    // 节点管理接口（仅用于测试环境）
    if (process.env.NODE_ENV === 'development') {
      this.app.post('/admin/restart', (req, res) => {
        logger.info('收到重启节点请求');

        // 在实际实现中应该有更复杂的重启逻辑
        res.status(200).json({ message: 'Node restart initiated' });

        // 模拟异步重启过程
        setTimeout(() => {
          this.committeeNode.stop();
          setTimeout(() => this.committeeNode.start(), 1000);
        }, 500);
      });
    }
  }

  // 将内部状态映射为更友好的状态字符串
  private mapStateToStatusString(state: TaskProcessingState): string {
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

    return stateMap[state] || 'unknown';
  }

  // 启动API服务器
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`API服务器已在端口 ${this.port} 上启动`);
          resolve();
        });
      } catch (error) {
        logger.error(`启动API服务器失败: ${error}`);
        reject(error);
      }
    });
  }

  // 停止API服务器
  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err: Error) => {
        if (err) {
          logger.error(`关闭API服务器时出错: ${err.message}`);
          reject(err);
        } else {
          logger.info('API服务器已关闭');
          resolve();
        }
      });
    });
  }
}
