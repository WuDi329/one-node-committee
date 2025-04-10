import { ValidationResult, QoSProof } from '../models/types';
import { logger } from '../utils/logger';

export class QoSValidator {
  private readonly SCORE_THRESHOLD = 3;

  public quickValidate(qosProof: QoSProof): ValidationResult {
    // logger.info(`对任务 ${qosProof.taskId} 执行快速验证`);

    // 1. 验证数据结构完整性
    const structureValidation = this.validateStructure(qosProof);
    if (!structureValidation.isValid) {
      return structureValidation;
    }

    // 2. 验证数值范围合理性
    const rangeValidation = this.validateValueRanges(qosProof);
    if (!rangeValidation.isValid) {
      return rangeValidation;
    }

    // 3. 验证时间戳逻辑
    const timeValidation = this.validateTimeLogic(qosProof);
    if (!timeValidation.isValid) {
      return timeValidation;
    }

    // 4. 验证签名
    const signatureValidation = this.validateSignature(qosProof);
    if (!signatureValidation.isValid) {
      return signatureValidation;
    }

    // 验证 gopScores 是否存在且非空
    if (
      !qosProof.videoQualityData.gopScores ||
      Object.keys(qosProof.videoQualityData.gopScores).length === 0
    ) {
      return {
        isValid: false,
        details: {
          reason: '视频质量数据缺少有效的GOP评分数据',
        },
      };
    }

    return { isValid: true };
  }

  // 验证数据结构完整性
  private validateStructure(proof: QoSProof): ValidationResult {
    // 验证必要字段是否存在
    const missingFields = [];

    if (!proof.taskId) missingFields.push('taskId');
    if (!proof.verifierId) missingFields.push('verifierId');
    if (proof.timestamp === undefined) missingFields.push('timestamp');
    if (!proof.mediaSpecs) missingFields.push('mediaSpecs');
    if (!proof.videoQualityData) missingFields.push('videoQualityData');
    if (!proof.signature) missingFields.push('signature');

    if (missingFields.length > 0) {
      return {
        isValid: false,
        details: {
          reason: '证明数据结构不完整',
          missingFields,
        },
      };
    }

    // 验证视频质量数据字段
    if (typeof proof.videoQualityData.overallScore !== 'number') {
      return {
        isValid: false,
        details: {
          reason: '视频质量数据缺少有效的总体评分',
        },
      };
    }

    return { isValid: true };
  }

  // 验证数值范围合理性
  private validateValueRanges(proof: QoSProof): ValidationResult {
    // 验证视频质量评分是否在合理范围内 (假设范围为0-100)
    const score = proof.videoQualityData.overallScore;
    if (score < 0 || score > 100) {
      return {
        isValid: false,
        details: {
          reason: '视频质量评分超出合理范围',
          score,
          expectedRange: '0-100',
        },
      };
    }

    // 验证媒体规格中的参数是否在合理范围内
    // 这里仅为示例，实际实现需要根据具体的mediaSpecs结构调整
    if (proof.mediaSpecs.bitrate && proof.mediaSpecs.bitrate <= 0) {
      return {
        isValid: false,
        details: {
          reason: '媒体码率不合理',
          bitrate: proof.mediaSpecs.bitrate,
        },
      };
    }

    return { isValid: true };
  }

  // 验证时间戳逻辑
  private validateTimeLogic(proof: QoSProof): ValidationResult {
    const now = Date.now();

    // 验证时间戳是否在未来
    if (proof.timestamp > now) {
      return {
        isValid: false,
        details: {
          reason: '时间戳验证失败',
          error: '证明时间戳晚于当前时间',
          timestamp: proof.timestamp,
          currentTime: now,
        },
      };
    }

    // 验证时间戳是否太旧（例如：超过7天）
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000; // 7天的毫秒数
    if (now - proof.timestamp > ONE_WEEK) {
      return {
        isValid: false,
        details: {
          reason: '时间戳验证失败',
          error: '证明时间戳过期',
          timestamp: proof.timestamp,
          currentTime: now,
          maxAge: ONE_WEEK,
        },
      };
    }

    // TODO: 如果有任务开始时间(Ts)，还应验证 Ts < proof.timestamp

    return { isValid: true };
  }

  // 验证签名
  // todo: 实际应用中需要使用加密库验证签名
  private validateSignature(proof: QoSProof): ValidationResult {
    // 实际应用中，这里应该使用加密库验证签名
    // 例如：使用 Verifier 的公钥验证 signature 是否与证明数据匹配

    // 此处为简化实现，仅检查签名是否存在
    if (!proof.signature || proof.signature.length === 0) {
      return {
        isValid: false,
        details: { reason: '签名无效' },
      };
    }

    // TODO: 实现实际的签名验证逻辑
    // logger.info(`签名验证暂未实现实际逻辑，假定签名有效`);

    return { isValid: true };
  }

  // 辅助方法：检查数组中所有数字是否完全相等
  private areAllEqual(numbers: number[]): boolean {
    if (numbers.length <= 1) return true;
    const first = numbers[0];
    return numbers.every(n => n === first);
  }

  private validateMediaSpecsConsistency(proofs: QoSProof[]): ValidationResult {
    // 提取所有证明中的媒体规格
    const mediaSpecs = proofs.map(p => p.mediaSpecs);

    // 验证编码格式一致性
    const codecSet = new Set(mediaSpecs.map(spec => spec.codec));
    if (codecSet.size > 1) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: proofs.map(p => p.verifierId),
        details: {
          reason: '编码格式不一致',
          codecs: Array.from(codecSet),
        },
      };
    }

    // 验证分辨率一致性
    const resolutionSet = new Set(mediaSpecs.map(spec => `${spec.width}x${spec.height}`));
    if (resolutionSet.size > 1) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: proofs.map(p => p.verifierId),
        details: {
          reason: '分辨率不一致',
          resolutions: Array.from(resolutionSet),
        },
      };
    }

    // 验证码率一致性（允许有小幅波动，例如5%的误差）
    const bitrates = mediaSpecs.map(spec => spec.bitrate);
    const avgBitrate = bitrates.reduce((sum, br) => sum + br, 0) / bitrates.length;
    const maxDeviation = avgBitrate * 0.05; // 允许5%的误差

    const hasBitrateConflict = bitrates.some(br => Math.abs(br - avgBitrate) > maxDeviation);

    if (hasBitrateConflict) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: proofs.map(p => p.verifierId),
        details: {
          reason: '码率差异过大',
          bitrates,
          averageBitrate: avgBitrate,
          maxDeviation,
        },
      };
    }

    // 验证音频存在性一致性
    const hasAudioSet = new Set(mediaSpecs.map(spec => !!spec.hasAudio));
    if (hasAudioSet.size > 1) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: proofs.map(p => p.verifierId),
        details: {
          reason: '音频存在性不一致',
          hasAudio: Array.from(hasAudioSet),
        },
      };
    }

    // 所有媒体规格验证通过
    return { isValid: true };
  }

  // 验证视频质量评分一致性
  private validateVideoQualityConsistency(proofs: QoSProof[]): ValidationResult {
    // 定义评分误差阈值
    const SCORE_THRESHOLD = 3; // 根据论文中的阈值

    // 1. 验证整体评分一致性
    const scores = proofs.map(p => p.videoQualityData.overallScore);
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

    // 检查是否有任何评分超出阈值范围
    for (let i = 0; i < proofs.length; i++) {
      if (Math.abs(scores[i] - avgScore) > SCORE_THRESHOLD) {
        return {
          isValid: false,
          hasConflict: true,
          conflictingVerifiers: [proofs[i].verifierId],
          details: {
            reason: '视频质量评分存在显著差异',
            scores,
            averageScore: avgScore,
            threshold: SCORE_THRESHOLD,
            outlierIndex: i,
            outlierVerifier: proofs[i].verifierId,
          },
        };
      }
    }

    // 2. 验证特定GOP样本评分一致性 (如果存在)
    const hasSpecifiedGOPs = proofs.some(p => Object.keys(p.videoQualityData.gopScores).length > 0);

    if (hasSpecifiedGOPs) {
      // 获取所有证明中共有的GOP IDs
      const commonGopIds = this.findCommonGopTimestamps(proofs);

      // 对每一个共同的GOP ID进行验证
      for (const gopId of commonGopIds) {
        const gopScores = proofs.map(p => this.getGopScore(p, gopId));

        // 过滤掉无效值
        const validScores = gopScores.filter(score => !isNaN(score));

        // 如果有足够的有效分数进行比较
        if (validScores.length >= 2) {
          // 对于特定GOP，分数应当完全一致
          const firstScore = validScores[0];
          const hasDiscrepancy = validScores.some(score => score !== firstScore);

          if (hasDiscrepancy) {
            return {
              isValid: false,
              hasConflict: true,
              conflictingVerifiers: proofs.map(p => p.verifierId),
              details: {
                reason: `特定GOP(${gopId})评分不一致`,
                gopScores: validScores,
              },
            };
          }
        }
      }
    }

    // 视频质量验证通过
    return { isValid: true };
  }

  // 查找所有证明中共有的GOP IDs
  // 查找所有证明中共有的GOP时间戳
  private findCommonGopTimestamps(proofs: QoSProof[]): string[] {
    // 获取第一个证明中的GOP时间戳
    const firstProofTimestamps = Object.keys(proofs[0].videoQualityData.gopScores);

    // 过滤出所有证明中都存在的GOP时间戳
    return firstProofTimestamps.filter(timestamp =>
      proofs.every(p => Object.keys(p.videoQualityData.gopScores).includes(timestamp))
    );
  }

  // 获取特定GOP时间戳的评分
  private getGopScore(proof: QoSProof, timestamp: string): number {
    const score = proof.videoQualityData.gopScores[timestamp];
    return score ? parseFloat(score) : NaN;
  }

  // 验证音频存在性和质量一致性
  private validateAudioConsistency(proofs: QoSProof[]): ValidationResult {
    // 首先检查是否所有证明都一致地报告了音频的存在或不存在
    const hasAudio = !!proofs[0].mediaSpecs.hasAudio;

    // 如果没有音频，就没有必要进一步验证音频质量
    if (!hasAudio) {
      // 验证所有证明都报告没有音频
      const allReportNoAudio = proofs.every(p => !p.mediaSpecs.hasAudio);
      if (!allReportNoAudio) {
        return {
          isValid: false,
          hasConflict: true,
          conflictingVerifiers: proofs.map(p => p.verifierId),
          details: {
            reason: '音频存在性报告不一致',
          },
        };
      }
      return { isValid: true };
    }

    // 检查是否所有证明都包含音频质量数据
    const missingAudioData = proofs.filter(p => !p.audioQualityData);
    if (missingAudioData.length > 0) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: missingAudioData.map(p => p.verifierId),
        details: {
          reason: '部分证明缺少音频质量数据',
          missingVerifiers: missingAudioData.map(p => p.verifierId),
        },
      };
    }

    // 对于存在音频的情况，验证音频质量评分的完全一致性
    const audioScores = proofs.map(p => p.audioQualityData.overallScore);
    const firstScore = audioScores[0];

    // 音频质量评分应该完全一致
    const hasDiscrepancy = audioScores.some(score => score !== firstScore);
    if (hasDiscrepancy) {
      return {
        isValid: false,
        hasConflict: true,
        conflictingVerifiers: proofs.map(p => p.verifierId),
        details: {
          reason: '音频质量评分不一致',
          audioScores,
        },
      };
    }

    // 音频验证通过
    return { isValid: true };
  }

  // 深度验证
  public deepValidate(proofs: QoSProof[]): ValidationResult {
    if (proofs.length < 2) {
      return {
        isValid: false,
        details: { reason: '证明数量不足，无法执行深度验证' },
      };
    }

    const taskId = proofs[0].taskId;
    // logger.info(`对任务 ${taskId} 执行深度验证，共 ${proofs.length} 个证明`);

    // 1. 验证媒体规格一致性
    const specValidation = this.validateMediaSpecsConsistency(proofs);
    if (!specValidation.isValid) {
      logger.warn(`任务 ${taskId} 的媒体规格验证失败: ${JSON.stringify(specValidation.details)}`);
      return specValidation;
    }

    // 2. 验证视频质量评分一致性
    const videoValidation = this.validateVideoQualityConsistency(proofs);
    if (!videoValidation.isValid) {
      logger.warn(`任务 ${taskId} 的视频质量验证失败: ${JSON.stringify(videoValidation.details)}`);
      return videoValidation;
    }

    // 3. 验证音频存在性和质量一致性（如果有音频）
    const audioValidation = this.validateAudioConsistency(proofs);
    if (!audioValidation.isValid) {
      logger.warn(`任务 ${taskId} 的音频验证失败: ${JSON.stringify(audioValidation.details)}`);
      return audioValidation;
    }

    // 4. 验证音视频同步性（暂时设为通过）
    logger.info(`任务 ${taskId} 的音视频同步性验证暂未实现，默认通过`);

    // 全部验证通过
    logger.info(`任务 ${taskId} 的深度验证全部通过`);
    return {
      isValid: true,
      details: {
        message: '所有深度验证通过',
        verifiersCount: proofs.length,
      },
    };
  }

  /**
   * 分析验证冲突类型
   * @param result 深度验证结果
   * @returns 冲突类型：结构性冲突、评分差异或无冲突
   */
  public analyzeConflictType(result: ValidationResult): 'structural' | 'score' | 'none' {
    if (!result.hasConflict) return 'none';

    // 根据details.reason判断冲突类型
    const reason = result.details?.reason || '';

    // 结构性冲突
    if (
      reason.includes('编码格式不一致') ||
      reason.includes('分辨率不一致') ||
      reason.includes('特定GOP') ||
      reason.includes('音频存在性不一致') ||
      reason.includes('音频质量评分不一致')
    ) {
      return 'structural';
    }

    // 评分差异冲突
    if (reason.includes('视频质量评分存在显著差异') || reason.includes('码率差异过大')) {
      return 'score';
    }

    // 默认视为结构性冲突（更严格的处理）
    return 'structural';
  }

  /**
   * 使用补充证明解决冲突
   * @param originalProofs 原始证明集合
   * @param supplementaryProof 补充证明
   * @param initialResult 初始验证结果
   * @returns 解决冲突后的验证结果
   */
  public resolveWithSupplementaryProof(
    originalProofs: QoSProof[],
    supplementaryProof: QoSProof,
    initialResult: ValidationResult
  ): ValidationResult {
    // 如果没有冲突类型，重新分析
    const conflictType = initialResult.conflictType || this.analyzeConflictType(initialResult);

    // console.log(`inside resolveWithSupplementaryProof`);
    // console.log(originalProofs);

    // 合并所有证明
    // const allProofs = [...originalProofs, supplementaryProof];

    // 根据冲突类型选择不同的解决策略
    if (conflictType === 'structural') {
      return this.resolveStructuralConflict(originalProofs, initialResult);
    } else {
      return this.resolveScoreConflict(originalProofs, initialResult);
    }
  }

  /**
   * 解决结构性冲突
   * @param proofs 所有证明（包括补充证明）
   * @param initialResult 初始验证结果
   * @returns 解决后的验证结果
   */
  private resolveStructuralConflict(
    proofs: QoSProof[],
    initialResult: ValidationResult
  ): ValidationResult {
    // 获取具体的冲突原因
    const reason = initialResult.details?.reason || '';
    let field = '';
    let values: any[] = [];

    // 根据原因确定冲突字段和值
    if (reason.includes('编码格式不一致')) {
      field = 'codec';
      values = proofs.map(p => p.mediaSpecs.codec);
    } else if (reason.includes('分辨率不一致')) {
      field = 'resolution';
      values = proofs.map(p => `${p.mediaSpecs.width}x${p.mediaSpecs.height}`);
    } else if (reason.includes('音频存在性不一致')) {
      field = 'hasAudio';
      values = proofs.map(p => p.mediaSpecs.hasAudio);
    } else if (reason.includes('特定GOP')) {
      // 针对GOP评分的特殊处理
      const gopTimestamp = this.extractGopTimestampFromReason(reason);
      if (gopTimestamp) {
        field = `gopScore-${gopTimestamp}`;
        values = proofs.map(p => p.videoQualityData.gopScores[gopTimestamp]);
      }
    } else if (reason.includes('音频质量评分不一致')) {
      field = 'audioScore';
      values = proofs.map(p => p.audioQualityData?.overallScore);
    }

    // 检查是否为空，如果是，可能无法识别具体冲突字段
    if (!field || values.length === 0) {
      return {
        ...initialResult,
        isValid: false,
        needsManualReview: true,
        resolvedBy: 'manual',
        details: {
          ...initialResult.details,
          additionalInfo: '无法识别具体冲突字段，需要人工审核',
        },
      };
    }

    // console.log(`统计的结果显示`);
    // console.log(values);

    // 统计每个值的出现次数
    const valueCounts = new Map<any, number>();
    values.forEach(value => {
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
    });

    // 寻找出现次数最多的值
    let maxCount = 0;
    let majorityValue: any = null;
    valueCounts.forEach((count, value) => {
      if (count > maxCount) {
        maxCount = count;
        majorityValue = value;
      }
    });

    // 冲突解决的结果
    let resolvedResult: ValidationResult;

    // 如果有超过半数的值相同
    if (maxCount >= 2) {
      // 确定可信和不可信验证者
      const reliableVerifiers: string[] = [];
      const unreliableVerifiers: string[] = [];

      proofs.forEach((proof, index) => {
        const proofValue = this.getValueByField(proof, field);
        if (proofValue === majorityValue) {
          reliableVerifiers.push(proof.verifierId);
        } else {
          unreliableVerifiers.push(proof.verifierId);
        }
      });

      resolvedResult = {
        isValid: true,
        resolvedBy: 'majority',
        details: {
          message: `通过多数表决解决${field}冲突`,
          majorityValue,
          reliableVerifiers,
          unreliableVerifiers,
        },
      };
    } else {
      // 无法形成多数派，需要人工审核
      resolvedResult = {
        isValid: false,
        needsManualReview: true,
        resolvedBy: 'manual',
        details: {
          reason: `无法通过多数表决解决${field}冲突，需要人工审核`,
          values,
        },
      };
    }

    return resolvedResult;
  }

  /**
   * 解决评分差异冲突
   * @param proofs 所有证明（包括补充证明）
   * @param initialResult 初始验证结果
   * @returns 解决后的验证结果
   */
  private resolveScoreConflict(
    proofs: QoSProof[],
    initialResult: ValidationResult
  ): ValidationResult {
    // 获取具体的冲突原因
    const reason = initialResult.details?.reason || '';
    let field = '';
    let values: number[] = [];

    // 根据原因确定冲突字段和值
    if (reason.includes('视频质量评分存在显著差异')) {
      field = 'videoScore';
      values = proofs.map(p => p.videoQualityData.overallScore);
    } else if (reason.includes('码率差异过大')) {
      field = 'bitrate';
      values = proofs.map(p => p.mediaSpecs.bitrate);
    }

    // 检查是否为空
    if (!field || values.length === 0) {
      return {
        ...initialResult,
        isValid: false,
        needsManualReview: true,
        resolvedBy: 'manual',
        details: {
          ...initialResult.details,
          additionalInfo: '无法识别具体冲突字段，需要人工审核',
        },
      };
    }

    // 计算中位数（适用于三个值的情况）
    const sortedValues = [...values].sort((a, b) => a - b);
    const medianValue = sortedValues[Math.floor(sortedValues.length / 2)];

    // 计算与中位数的差异
    const deviations = values.map(v => Math.abs(v - medianValue));

    // 找出最接近中位数的两个值
    const indexPairs = deviations.map((dev, i) => ({ index: i, deviation: dev }));
    indexPairs.sort((a, b) => a.deviation - b.deviation);
    const closestIndices = indexPairs.slice(0, 2).map(pair => pair.index);

    // 确定可信和不可信验证者
    const reliableVerifiers: string[] = [];
    const unreliableVerifiers: string[] = [];

    proofs.forEach((proof, index) => {
      if (closestIndices.includes(index)) {
        reliableVerifiers.push(proof.verifierId);
      } else {
        unreliableVerifiers.push(proof.verifierId);
      }
    });

    // 构建解决结果
    return {
      isValid: true,
      resolvedBy: 'statistical',
      details: {
        message: `通过统计方法解决${field}冲突`,
        medianValue,
        reliableVerifiers,
        unreliableVerifiers,
        allValues: values,
      },
    };
  }

  /**
   * 从原因描述中提取GOP时间戳
   * @param reason 原因描述
   * @returns GOP时间戳或null
   */
  private extractGopTimestampFromReason(reason: string): string | null {
    const match = reason.match(/特定GOP\(([^)]+)\)/);
    return match ? match[1] : null;
  }

  /**
   * 根据字段名获取证明中的值
   * @param proof QoS证明
   * @param field 字段名
   * @returns 字段值
   */
  private getValueByField(proof: QoSProof, field: string): any {
    if (field === 'codec') return proof.mediaSpecs.codec;
    if (field === 'resolution') return `${proof.mediaSpecs.width}x${proof.mediaSpecs.height}`;
    if (field === 'hasAudio') return proof.mediaSpecs.hasAudio;
    if (field === 'audioScore') return proof.audioQualityData?.overallScore;
    if (field === 'videoScore') return proof.videoQualityData.overallScore;
    if (field === 'bitrate') return proof.mediaSpecs.bitrate;
    if (field.startsWith('gopScore-')) {
      const timestamp = field.replace('gopScore-', '');
      return proof.videoQualityData.gopScores[timestamp];
    }
    return null;
  }
}
