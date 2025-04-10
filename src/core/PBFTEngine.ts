import {
  MessageType,
  ConsensusState,
  PBFTMessage,
  ValidationResult,
  QoSProof,
  ConsensusType,
} from '../models/types';
import { calculateHash, sign } from '../utils/crypto';
import { logger } from '../utils/logger';
import { GlobalMetricsCollector } from '../service/GlobalMetricsCollector';
import { EventData, EventType } from '../models/types';

export class PBFTEngine {
  private viewNumber: number = 0;
  private sequenceNumber: number = 0;
  private currentConsensusType: ConsensusType = ConsensusType.Normal;
  private nodeId: string;
  private state: ConsensusState = ConsensusState.Idle;
  private isLeader: boolean;
  private prepareMessages: Map<string, PBFTMessage[]> = new Map();
  private commitMessages: Map<string, PBFTMessage[]> = new Map();
  private pendingPrepareMessages: Map<string, PBFTMessage[]> = new Map();
  private pendingCommitMessages: Map<string, PBFTMessage[]> = new Map();
  private completedSequences: Set<number> = new Set();
  private currentProposal: QoSProof | null = null;
  private currentDigest: string = '';
  private onConsensusReached: (proof: QoSProof, type: ConsensusType) => void;
  // private validationResults: Map<string, ValidationResult> = new Map();
  private consensusThreshold: number;
  private privateKey: string = 'private_key';

  constructor(
    nodeId: string,
    isLeader: boolean,
    totalNodes: number,
    onConsensusReached: (proof: QoSProof, consensusType: ConsensusType) => void,
    privateKey?: string
  ) {
    this.nodeId = nodeId;
    this.isLeader = isLeader;
    this.onConsensusReached = onConsensusReached;
    this.privateKey = privateKey || 'private_key';
    // 设置共识阈值 (2f+1，假设f = (n-1)/3)
    this.consensusThreshold = Math.floor(2 * Math.floor((totalNodes - 1) / 3) + 1);
    logger.info(
      `Node ${nodeId} initialized as ${isLeader ? 'leader' : 'follower'}, consensus threshold: ${this.consensusThreshold}`
    );
  }

  public getCurrentViewNumber(): number {
    return this.viewNumber;
  }

  public getNextSequenceNumber(): number {
    this.sequenceNumber += 1;
    return this.sequenceNumber;
  }

  // Leader生成PrePrepare消息
  public startConsensus(proof: QoSProof, consensusType: ConsensusType): PBFTMessage | null {
    if (!this.isLeader) {
      logger.warn(`Non-leader node ${this.nodeId} attempted to start consensus`);
      return null;
    }

    if (this.state !== ConsensusState.Idle) {
      logger.warn(`Leader node ${this.nodeId} is already in consensus process`);
      return null;
    }

    this.sequenceNumber++;
    this.currentProposal = proof;
    this.currentDigest = calculateHash(proof);
    this.currentConsensusType = consensusType;
    this.state = ConsensusState.PrePrepared;

    // 创建PrePrepare消息
    const prePrepareMsg: PBFTMessage = {
      type: MessageType.PrePrepare,
      consensusType: this.currentConsensusType,
      viewNumber: this.viewNumber,
      taskId: proof.taskId,
      sequenceNumber: this.sequenceNumber,
      nodeId: this.nodeId,
      data: proof,
      digest: this.currentDigest,
      signature: sign(
        {
          type: MessageType.PrePrepare,
          consensusType: this.currentConsensusType,
          viewNumber: this.viewNumber,
          sequenceNumber: this.sequenceNumber,
          digest: this.currentDigest,
        },
        'private_key'
      ), // 模拟私钥
    };

    logger.info(`Leader ${this.nodeId} created PrePrepare message for seq ${this.sequenceNumber}`);
    return prePrepareMsg;
  }

  private calculateDigest(data: any): string {
    return calculateHash(data);
  }

  private signMessage(data: any): string {
    return sign(data, this.privateKey);
  }

  // 处理PrePrepare消息
  public handlePrePrepare(message: PBFTMessage): PBFTMessage | null {
    // 移除Leader不处理PrePrepare的限制

    // if (this.isLeader) {
    //   logger.debug(`Leader ignoring PrePrepare message`);
    //   return null; // Leader不处理PrePrepare
    // }

    if (
      this.state !== ConsensusState.Idle &&
      !(this.isLeader && this.state === ConsensusState.PrePrepared)
    ) {
      // 特殊情况：允许Leader在PrePrepared状态处理自己的PrePrepare
      logger.warn(`Node ${this.nodeId} received PrePrepare while in ${this.state} state`);
      return null;
    }

    // 验证消息
    if (!this.validateMessage(message)) {
      return null;
    }

    if (!message.data) {
      logger.error('PrePrepare message missing data');
      return null;
    }

    // 验证digest
    const calculatedDigest = calculateHash(message.data);
    if (calculatedDigest !== message.digest) {
      logger.error(`Digest mismatch: ${calculatedDigest} vs ${message.digest}`);
      return null;
    }

    // 对于非Leader节点或Leader处理自己的消息时，更新状态
    if (!this.isLeader || (this.isLeader && message.nodeId === this.nodeId)) {
      this.currentProposal = message.data as QoSProof;
      this.currentDigest = message.digest;
      this.viewNumber = message.viewNumber!;
      this.sequenceNumber = message.sequenceNumber!;
      this.state = ConsensusState.PrePrepared;
      this.currentConsensusType = message.consensusType || ConsensusType.Normal;
    }

    const prepareMsg: PBFTMessage = {
      taskId: message.taskId,
      type: MessageType.Prepare,
      consensusType: this.currentConsensusType,
      viewNumber: this.viewNumber,
      sequenceNumber: this.sequenceNumber,
      nodeId: this.nodeId,
      digest: this.currentDigest,
      signature: sign(
        {
          type: MessageType.Prepare,
          consensusType: this.currentConsensusType,
          viewNumber: this.viewNumber,
          sequenceNumber: this.sequenceNumber,
          digest: this.currentDigest,
        },
        'private_key'
      ), // 模拟私钥
    };

    logger.info(
      `Node ${this.nodeId} 已经处理了来自 ${message.nodeId} 的PrePrepare信令，inside handlePrePrepare`
    );

    const key = `${this.viewNumber}:${this.sequenceNumber}`;
    if (!this.prepareMessages.has(key)) {
      this.prepareMessages.set(key, []);
    }

    this.prepareMessages.get(key)!.push(prepareMsg);

    // 添加日志，确认消息被正确添加
    logger.info(
      `节点 ${this.nodeId} 已将自己的Prepare消息添加到列表中，当前有 ${this.prepareMessages.get(key)!.length} 条Prepare消息`
    );

    // this.processPendingPrepareMessages();

    // console.warn(prepareMsg);

    return prepareMsg;
  }

  // 添加新的方法来存储暂存的Prepare消息
  private storePendingPrepareMessage(message: PBFTMessage): void {
    const key = `${message.viewNumber}:${message.sequenceNumber}`;
    if (!this.pendingPrepareMessages.has(key)) {
      this.pendingPrepareMessages.set(key, []);
    }
    // 检查是否已经存在来自同一节点的消息
    const pendingMsgs = this.pendingPrepareMessages.get(key)!;
    const existingMsg = pendingMsgs.find(m => m.nodeId === message.nodeId);

    if (!existingMsg) {
      pendingMsgs.push(message);
      logger.info(
        `Node ${this.nodeId} 存储 待处理 的 Prepare 信令 for seq ${message.sequenceNumber}，现在pending 的 Prepare 信令长度为${pendingMsgs.length}`
      );
    }
  }

  // private processPendingPrepareMessages(): void {
  //   const key = `${this.viewNumber}:${this.sequenceNumber}`;
  //   const pendingMsgs = this.pendingPrepareMessages.get(key);

  //   if (!pendingMsgs || pendingMsgs.length === 0) {
  //     return;
  //   }

  //   logger.info(`Node ${this.nodeId} 处理 pending的 ${pendingMsgs.length} 个 Prepare 信令`);

  //   // 复制一份列表并清空原列表，防止递归处理
  //   const messagesToProcess = [...pendingMsgs];
  //   this.pendingPrepareMessages.delete(key);

  //   // 直接将这些消息添加到prepareMessages
  //   if (!this.prepareMessages.has(key)) {
  //     this.prepareMessages.set(key, []);
  //   }

  //   const prepareList = this.prepareMessages.get(key)!;
  //   let commitMessageToSend: PBFTMessage | null = null;

  //   for (const msg of messagesToProcess) {
  //     // 检查是否已经有来自同一节点的消息
  //     const duplicateIndex = prepareList.findIndex(m => m.nodeId === msg.nodeId);

  //     if (duplicateIndex === -1) {
  //       prepareList.push(msg);

  //       // 每添加一条消息就检查一次是否达到阈值
  //       const prepareCount = prepareList.length;
  //       logger.warn(
  //         `节点 ${this.nodeId} 针对任务${msg.sequenceNumber} 现在拥有 ${prepareCount}/${this.consensusThreshold} 条 Prepare 信令`
  //       );

  //       // 如果添加这条消息后达到阈值，就进入Prepared状态
  //       if (prepareCount >= this.consensusThreshold && this.state === ConsensusState.PrePrepared) {
  //         this.state = ConsensusState.Prepared;
  //         logger.warn(
  //           `Node ${this.nodeId} accepted Prepare, 为 seq ${this.sequenceNumber} 广播 Commit 信令`
  //         );

  //         // 创建Commit消息
  //         commitMessageToSend = this.createCommitMessage();

  //         // 处理待处理的Commit消息
  //         this.processPendingCommitMessages();

  //         // 不在这里返回，继续处理其他消息
  //       }
  //     }
  //   }

  //   // 如果生成了commitMessage，通过外部机制传递出去
  //   if (commitMessageToSend) {
  //     // 可以通过类成员变量或回调函数传递这个消息
  //     this.pendingCommitMessageToSend = commitMessageToSend;
  //   }

  //   // 函数结束，不返回任何值
  // }

  // 单独提取创建Commit消息的逻辑
  // private createCommitMessage(): PBFTMessage {
  //   const commitMsg: PBFTMessage = {
  //     type: MessageType.Commit,
  //     consensusType: this.currentConsensusType,
  //     viewNumber: this.viewNumber,
  //     sequenceNumber: this.sequenceNumber,
  //     nodeId: this.nodeId,
  //     digest: this.currentDigest,
  //     signature: sign(
  //       {
  //         type: MessageType.Commit,
  //         viewNumber: this.viewNumber,
  //         sequenceNumber: this.sequenceNumber,
  //         digest: this.currentDigest,
  //       },
  //       'private_key'
  //     ),
  //   };

  //   // 将自己的Commit消息存入集合
  //   const key = `${this.viewNumber}:${this.sequenceNumber}`;
  //   if (!this.commitMessages.has(key)) {
  //     this.commitMessages.set(key, []);
  //   }
  //   this.commitMessages.get(key)!.push(commitMsg);

  //   return commitMsg;
  // }

  private storePendingCommitMessage(message: PBFTMessage): void {
    const key = `${message.viewNumber}:${message.sequenceNumber}`;
    if (!this.pendingCommitMessages.has(key)) {
      this.pendingCommitMessages.set(key, []);
    }
    this.pendingCommitMessages.get(key)?.push(message);
    logger.info(
      `Node ${this.nodeId} stored pending Commit message for seq ${message.sequenceNumber} from ${message.nodeId}`
    );
  }

  // // 添加方法来处理暂存的Commit消息
  // private processPendingCommitMessages(): void {
  //   const key = `${this.viewNumber}:${this.sequenceNumber}`;
  //   const pendingMessages = this.pendingCommitMessages.get(key) || [];

  //   if (pendingMessages.length > 0) {
  //     logger.info(
  //       `Node ${this.nodeId} processing ${pendingMessages.length} pending Commit messages for seq ${this.sequenceNumber}`
  //     );

  //     // 将暂存的Commit消息添加到正式的Commit消息集合中
  //     if (!this.commitMessages.has(key)) {
  //       this.commitMessages.set(key, []);
  //     }

  //     for (const message of pendingMessages) {
  //       this.commitMessages.get(key)?.push(message);
  //       logger.debug(
  //         `Node ${this.nodeId} processed pending Commit from ${message.nodeId} for seq ${message.sequenceNumber}`
  //       );
  //     }

  //     // 清空已处理的暂存消息
  //     this.pendingCommitMessages.delete(key);

  //     // 检查是否达成共识
  //     this.checkCommitConsensus(key);
  //   }
  // }

  // 处理Prepare消息
  public handlePrepare(message: PBFTMessage): PBFTMessage | null {
    if (!this.validateMessage(message)) {
      return null;
    }

    if (this.completedSequences.has(message.sequenceNumber!)) {
      logger.info(
        `节点 ${this.nodeId} 已对序列号 ${message.sequenceNumber} 达成共识，忽略晚到的Prepare消息`
      );
      return null;
    }

    // console.log(`问题场景：${this.nodeId}收到了来自${message.nodeId}的prepare信息`);

    const key = `${message.viewNumber}:${message.sequenceNumber}`;

    // 【强化】更严格的状态检查 - 如果当前状态已经超过 PrePrepared，则忽略 Prepare 消息
    if (this.state > ConsensusState.PrePrepared) {
      logger.warn(`Node ${this.nodeId} ignoring Prepare message in ${this.state} state`);
      return null;
    } else if (this.state < ConsensusState.PrePrepared) {
      logger.warn(`Node ${this.nodeId} received Prepare but not in PrePrepared state`);
      this.storePendingPrepareMessage(message);
      return null;
    }

    // 初始化消息列表
    if (!this.prepareMessages.has(key)) {
      this.prepareMessages.set(key, []);
    }

    if (message.nodeId === this.nodeId && this.prepareMessages.get(key)!.length === 1) {
      const pendingMessages = this.pendingPrepareMessages.get(key) || [];

      // 清空待处理消息队列
      this.pendingPrepareMessages.delete(key);

      if (pendingMessages.length > 0) {
        logger.info(`Node ${this.nodeId} 处理 ${pendingMessages.length} 条待处理的Prepare信令`);

        // 将所有非重复的待处理消息添加到prepareMessages
        for (const pendingMsg of pendingMessages) {
          // 避免添加重复消息
          if (!this.prepareMessages.get(key)!.some(m => m.nodeId === pendingMsg.nodeId)) {
            this.prepareMessages.get(key)!.push(pendingMsg);
          }
        }
      }
    }

    // 检查当前消息是否已存在（避免重复添加）
    if (this.prepareMessages.get(key)!.some(m => m.nodeId === message.nodeId)) {
      logger.warn(`节点 ${this.nodeId} 已收到来自 ${message.nodeId} 的Prepare消息，忽略重复`);
      // return null;
    } else {
      // 存储当前消息
      this.prepareMessages.get(key)!.push(message);
    }

    // 检查是否收到足够的Prepare消息
    const prepareCount = this.prepareMessages.get(key)?.length || 0;
    logger.warn(
      `节点 ${this.nodeId} 针对任务${message.sequenceNumber} 现在拥有 ${prepareCount}/${this.consensusThreshold} 条 Prepare 信令`
    );

    if (prepareCount >= this.consensusThreshold && this.state === ConsensusState.PrePrepared) {
      this.state = ConsensusState.Prepared;
      logger.warn(
        `Node ${this.nodeId} accepted Prepare, 为 seq ${this.sequenceNumber} 广播 Commit 信令 `
      );

      // 创建Commit消息
      const commitMsg: PBFTMessage = {
        taskId: message.taskId,
        type: MessageType.Commit,
        consensusType: this.currentConsensusType,
        viewNumber: this.viewNumber,
        sequenceNumber: this.sequenceNumber,
        nodeId: this.nodeId,
        digest: this.currentDigest,
        signature: sign(
          {
            type: MessageType.Commit,
            viewNumber: this.viewNumber,
            sequenceNumber: this.sequenceNumber,
            digest: this.currentDigest,
          },
          'private_key'
        ), // 模拟私钥
      };

      // 这里改动

      // 将自己的Commit消息先存入集合
      // const key = `${this.viewNumber}:${this.sequenceNumber}`;
      if (!this.commitMessages.has(key)) {
        this.commitMessages.set(key, []);
      }
      this.commitMessages.get(key)!.push(commitMsg);

      logger.info(
        `节点 ${this.nodeId} 已将自己的Commit消息添加到列表中，当前有 ${this.commitMessages.get(key)!.length} 条Commit消息`
      );

      return commitMsg;
    }

    return null;
  }

  // 添加方法来检查Commit消息是否达到共识阈值
  private checkCommitConsensus(key: string): void {
    const commitCount = this.commitMessages.get(key)?.length || 0;
    console.warn(
      `Node ${this.nodeId} has ${commitCount}/${this.consensusThreshold} Commit messages for seq ${this.sequenceNumber}`
    );

    if (commitCount >= this.consensusThreshold && this.state === ConsensusState.Prepared) {
      this.state = ConsensusState.Committed;
      logger.info(`Node ${this.nodeId} 对 seq ${this.sequenceNumber}抵达共识状态`);

      // 记录已完成共识的序列号
      this.completedSequences.add(this.sequenceNumber);

      // 执行共识达成回调
      if (this.currentProposal) {
        if (this.currentConsensusType === ConsensusType.Normal) {
          logger.info(
            `Node ${this.nodeId} reached normal consensus for seq ${this.sequenceNumber}`
          );
        } else {
          logger.info(
            `Node ${this.nodeId} reached conflict consensus for seq ${this.sequenceNumber}, but there is a conflict`
          );
        }
        this.onConsensusReached(this.currentProposal, this.currentConsensusType);
      }

      // 重置状态，准备下一轮共识
      this.resetForNextConsensus();
    }
  }

  // 处理Commit消息
  public handleCommit(message: PBFTMessage): void {
    // console.warn(`${this.nodeId}进入handleCommit`);
    if (!this.validateMessage(message)) {
      return;
    }

    if (this.completedSequences.has(message.sequenceNumber!)) {
      logger.info(
        `节点 ${this.nodeId} 已对序列号 ${message.sequenceNumber} 达成共识，忽略晚到的Commit消息`
      );
      return;
    }

    const key = `${message.viewNumber}:${message.sequenceNumber}`;

    if (this.state > ConsensusState.Prepared) {
      logger.warn(`Node ${this.nodeId} ignoring Commit message in ${this.state} state`);
      return;
    } else if (this.state < ConsensusState.Prepared) {
      // logger.warn(`Node ${this.nodeId} received Commit but not in Prepared state`);
      // 暂存这个Commit消息，等到进入Prepared状态再处理
      this.storePendingCommitMessage(message);
      return;
    }

    // 初始化消息列表

    if (!this.commitMessages.has(key)) {
      this.commitMessages.set(key, []);
    }

    if (message.nodeId === this.nodeId && this.commitMessages.get(key)!.length === 1) {
      const pendingCommitMessages = this.pendingCommitMessages.get(key) || [];

      // 清空待处理消息队列
      this.pendingCommitMessages.delete(key);

      if (pendingCommitMessages.length > 0) {
        logger.info(
          `Node ${this.nodeId} 处理 ${pendingCommitMessages.length} 条待处理的Commit信令`
        );

        // 将所有非重复的待处理消息添加到commitMessages
        for (const pendingMsg of pendingCommitMessages) {
          // 避免添加重复消息
          if (!this.commitMessages.get(key)!.some(m => m.nodeId === pendingMsg.nodeId)) {
            this.commitMessages.get(key)!.push(pendingMsg);
          }
        }
      }
    }

    // 检查当前消息是否已存在（避免重复添加）
    if (this.commitMessages.get(key)!.some(m => m.nodeId === message.nodeId)) {
      logger.warn(`节点 ${this.nodeId} 已收到来自 ${message.nodeId} 的Commit消息，忽略重复`);
    } else {
      // 存储当前消息
      this.commitMessages.get(key)!.push(message);
    }

    // 检查是否收到足够的Commit消息
    this.checkCommitConsensus(key);
  }

  // 验证消息基本有效性
  private validateMessage(message: PBFTMessage): boolean {
    // 检查视图编号
    if (message.viewNumber !== this.viewNumber) {
      logger.warn(`Message view number mismatch: ${message.viewNumber} vs ${this.viewNumber}`);
      return false;
    }

    // 验证签名 (简化实现)
    return true;
  }

  // 重置状态为下一轮共识
  private resetForNextConsensus(): void {
    this.state = ConsensusState.Idle;
    this.currentProposal = null;
    this.currentDigest = '';
    this.currentConsensusType = ConsensusType.Normal;
    // 清理消息缓存可以在此处进行，或定期执行

    // 清理暂存的消息
    const keyToClean = `${this.viewNumber}:${this.sequenceNumber}`;
    this.pendingCommitMessages.delete(keyToClean);
  }

  // 获取当前状态
  public getState(): ConsensusState {
    return this.state;
  }
}
