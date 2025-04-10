import { QoSValidator } from '../src/validators/QoSValidator';
import { QoSProof, ValidationResult } from '../src/models/types';
import { logger } from '../src/utils/logger';

// Mock logger
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('QoSValidator', () => {
  let validator: QoSValidator;
  let validProof: QoSProof;
  const now = Date.now();
  const oneWeekAgo = now - 6 * 24 * 60 * 60 * 1000; // 6天前

  beforeEach(() => {
    validator = new QoSValidator();

    // 创建一个有效的 QoS 证明对象供测试使用
    validProof = {
      taskId: 'task-123',
      verifierId: 'verifier-456',
      timestamp: oneWeekAgo,
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
          '1000': '87.5',
          '2000': '83.2',
          '3000': '86.7',
        },
      },
      audioQualityData: {
        overallScore: 90,
      },
      signature: 'valid-signature-data',
    };

    // 重置所有模拟函数
    jest.clearAllMocks();
  });

  // 1. quickValidate 测试用例
  describe('quickValidate', () => {
    test('1.1: 有效的 QoS 证明通过验证', () => {
      const result = validator.quickValidate(validProof);
      expect(result.isValid).toBe(true);
    });

    test('1.2: 缺少必填字段失败验证', () => {
      // 创建一个新对象，删除taskId而不是设为undefined
      const { taskId, ...invalidProof } = validProof;
      const result = validator.quickValidate(invalidProof as any);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('证明数据结构不完整');
      expect(result.details?.missingFields).toContain('taskId');
    });

    test('1.3: 值范围超出合理范围失败验证', () => {
      const proofWithInvalidScore = {
        ...validProof,
        videoQualityData: {
          ...validProof.videoQualityData,
          overallScore: 110,
        },
      };

      const result = validator.quickValidate(proofWithInvalidScore);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('视频质量评分超出合理范围');
      expect(result.details?.score).toBe(110);
      expect(result.details?.expectedRange).toBe('0-100');
    });

    test('1.4: 未来时间戳失败验证', () => {
      const futureDate = now + 1000 * 60 * 60; // 一小时后
      const proofWithFutureTimestamp = {
        ...validProof,
        timestamp: futureDate,
      };

      const result = validator.quickValidate(proofWithFutureTimestamp);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('时间戳验证失败');
      expect(result.details?.error).toBe('证明时间戳晚于当前时间');
    });

    test('1.5: 过期时间戳失败验证', () => {
      const tooOldDate = now - 8 * 24 * 60 * 60 * 1000; // 8天前
      const proofWithOldTimestamp = {
        ...validProof,
        timestamp: tooOldDate,
      };

      const result = validator.quickValidate(proofWithOldTimestamp);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('时间戳验证失败');
      expect(result.details?.error).toBe('证明时间戳过期');
    });

    test('1.6: 无效签名失败验证', () => {
      const proofWithInvalidSignature = {
        ...validProof,
        signature: '',
      };

      const result = validator.quickValidate(proofWithInvalidSignature);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('证明数据结构不完整');
    });

    test('1.7: 缺少 GOP 评分数据失败验证', () => {
      const proofWithEmptyGopScores = {
        ...validProof,
        videoQualityData: {
          ...validProof.videoQualityData,
          gopScores: {},
        },
      };

      const result = validator.quickValidate(proofWithEmptyGopScores);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('视频质量数据缺少有效的GOP评分数据');
    });
  });

  // 2. deepValidate 测试用例
  describe('deepValidate', () => {
    let validProof2: QoSProof;

    beforeEach(() => {
      // 创建第二个有效的证明对象，与第一个保持一致
      validProof2 = JSON.parse(JSON.stringify(validProof));
      validProof2.verifierId = 'verifier-789';
    });

    test('2.1: 证明数量不足失败验证', () => {
      const result = validator.deepValidate([validProof]);

      expect(result.isValid).toBe(false);
      expect(result.details?.reason).toBe('证明数量不足，无法执行深度验证');
    });

    test('2.2: 所有项目一致时通过验证', () => {
      const result = validator.deepValidate([validProof, validProof2]);

      expect(result.isValid).toBe(true);
      expect(result.details?.message).toBe('所有深度验证通过');
      expect(result.details?.verifiersCount).toBe(2);
    });

    test('2.3: 编码格式不一致失败验证', () => {
      const proofWithDifferentCodec = {
        ...validProof2,
        mediaSpecs: {
          ...validProof2.mediaSpecs,
          codec: 'H.265',
        },
      };

      const result = validator.deepValidate([validProof, proofWithDifferentCodec]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('编码格式不一致');
      expect(result.details?.codecs).toContain('H.264');
      expect(result.details?.codecs).toContain('H.265');
    });

    test('2.4: 分辨率不一致失败验证', () => {
      const proofWithDifferentResolution = {
        ...validProof2,
        mediaSpecs: {
          ...validProof2.mediaSpecs,
          width: 1280,
          height: 720,
        },
      };

      const result = validator.deepValidate([validProof, proofWithDifferentResolution]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('分辨率不一致');
      expect(result.details?.resolutions).toContain('1920x1080');
      expect(result.details?.resolutions).toContain('1280x720');
    });

    test('2.5: 码率差异超过阈值失败验证', () => {
      const proofWithHighBitrate = {
        ...validProof2,
        mediaSpecs: {
          ...validProof2.mediaSpecs,
          bitrate: 5550, // 超过5%的差异（5000 * 1.06）
        },
      };

      const result = validator.deepValidate([validProof, proofWithHighBitrate]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('码率差异过大');
      expect(result.details?.bitrates).toContain(5000);
      expect(result.details?.bitrates).toContain(5550);
    });

    test('2.6: 视频评分差异超过阈值失败验证', () => {
      const proofWithDifferentScore = {
        ...validProof2,
        videoQualityData: {
          ...validProof2.videoQualityData,
          overallScore: 92, // 差异5分，超过阈值3分
        },
      };

      const result = validator.deepValidate([validProof, proofWithDifferentScore]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('视频质量评分存在显著差异');
    });

    test('2.7: GOP 评分不一致失败验证', () => {
      const proofWithDifferentGopScore = {
        ...validProof2,
        videoQualityData: {
          ...validProof2.videoQualityData,
          gopScores: {
            ...validProof2.videoQualityData.gopScores,
            '1000': '88.5', // 原先是87.5
          },
        },
      };

      const result = validator.deepValidate([validProof, proofWithDifferentGopScore]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toContain('特定GOP');
      expect(result.details?.reason).toContain('评分不一致');
    });

    test('2.8: 音频存在性不一致失败验证', () => {
      const proofWithoutAudio = {
        ...validProof2,
        mediaSpecs: {
          ...validProof2.mediaSpecs,
          hasAudio: false,
        },
      };

      const result = validator.deepValidate([validProof, proofWithoutAudio]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('音频存在性不一致');
    });

    test('2.9: 音频质量评分不一致失败验证', () => {
      const proofWithDifferentAudioScore = {
        ...validProof2,
        audioQualityData: {
          ...validProof2.audioQualityData,
          overallScore: 85, // 原先是90
        },
      };

      const result = validator.deepValidate([validProof, proofWithDifferentAudioScore]);

      expect(result.isValid).toBe(false);
      expect(result.hasConflict).toBe(true);
      expect(result.details?.reason).toBe('音频质量评分不一致');
    });

    test('2.10: 边缘情况 - 码率差异接近阈值但仍然有效', () => {
      const proofWithAcceptableBitrate = {
        ...validProof2,
        mediaSpecs: {
          ...validProof2.mediaSpecs,
          bitrate: 5240, // 差异4.8%，接近但不超过5%
        },
      };

      const result = validator.deepValidate([validProof, proofWithAcceptableBitrate]);

      expect(result.isValid).toBe(true);
    });
  });

  // 3. 补充验证场景测试
  describe('补充验证场景', () => {
    let validProof2: QoSProof;
    let validProof3: QoSProof;

    beforeEach(() => {
      // 创建第二、三个有效的证明对象
      validProof2 = JSON.parse(JSON.stringify(validProof));
      validProof2.verifierId = 'verifier-789';

      validProof3 = JSON.parse(JSON.stringify(validProof));
      validProof3.verifierId = 'verifier-101';
    });

    test('3.1: 整体评分差异过大但其他方面一致的补充验证', () => {
      // 设置评分差异：第一个85分，第二个77分，差距7分
      validProof2.videoQualityData.overallScore = 77;

      // 第三个证明的评分接近第一个
      validProof3.videoQualityData.overallScore = 84;

      // 第一步：初始验证应该失败
      const initialResult = validator.deepValidate([validProof, validProof2]);
      expect(initialResult.isValid).toBe(false);
      expect(initialResult.hasConflict).toBe(true);
      expect(initialResult.details?.reason).toBe('视频质量评分存在显著差异');

      // 分析冲突类型
      const conflictType = validator.analyzeConflictType(initialResult);
      expect(conflictType).toBe('score');

      // 构造带有冲突类型的初始结果
      const initialResultWithType = {
        ...initialResult,
        conflictType,
      };

      // 第二步：使用补充证明解决冲突
      const resolvedResult = validator.resolveWithSupplementaryProof(
        [validProof, validProof2],
        validProof3,
        initialResultWithType
      );

      // 验证结果
      expect(resolvedResult.isValid).toBe(true);
      expect(resolvedResult.resolvedBy).toBe('statistical');
      expect(resolvedResult.details.reliableVerifiers).toContain(validProof.verifierId);
      expect(resolvedResult.details.reliableVerifiers).toContain(validProof3.verifierId);
      expect(resolvedResult.details.unreliableVerifiers).toContain(validProof2.verifierId);
    });

    test('3.2: 存在结构性冲突的补充验证', () => {
      // 设置结构性冲突：编码格式不一致
      validProof2.mediaSpecs.codec = 'H.265';

      // 第三个证明与第一个一致
      validProof3.mediaSpecs.codec = 'H.264';

      // 第一步：初始验证应该失败
      const initialResult = validator.deepValidate([validProof, validProof2]);
      expect(initialResult.isValid).toBe(false);
      expect(initialResult.hasConflict).toBe(true);
      expect(initialResult.details?.reason).toBe('编码格式不一致');

      // 分析冲突类型
      const conflictType = validator.analyzeConflictType(initialResult);
      expect(conflictType).toBe('structural');

      // 构造带有冲突类型的初始结果
      const initialResultWithType = {
        ...initialResult,
        conflictType,
      };

      // 第二步：使用补充证明解决冲突
      const resolvedResult = validator.resolveWithSupplementaryProof(
        [validProof, validProof2],
        validProof3,
        initialResultWithType
      );

      // 验证结果
      expect(resolvedResult.isValid).toBe(true);
      expect(resolvedResult.resolvedBy).toBe('majority');
      expect(resolvedResult.details.majorityValue).toBe('H.264');
      expect(resolvedResult.details.reliableVerifiers).toContain(validProof.verifierId);
      expect(resolvedResult.details.reliableVerifiers).toContain(validProof3.verifierId);
      expect(resolvedResult.details.unreliableVerifiers).toContain(validProof2.verifierId);
    });

    test('3.3: 无法形成多数派的结构性冲突补充验证', () => {
      // 设置三方各不相同的结构性冲突
      validProof.mediaSpecs.codec = 'H.264';
      validProof2.mediaSpecs.codec = 'H.265';
      validProof3.mediaSpecs.codec = 'VP9';

      // 第一步：初始验证应该失败
      const initialResult = validator.deepValidate([validProof, validProof2]);
      expect(initialResult.isValid).toBe(false);
      expect(initialResult.hasConflict).toBe(true);
      expect(initialResult.details?.reason).toBe('编码格式不一致');

      // 分析冲突类型
      const conflictType = validator.analyzeConflictType(initialResult);
      expect(conflictType).toBe('structural');

      // 构造带有冲突类型的初始结果
      const initialResultWithType = {
        ...initialResult,
        conflictType,
      };

      // 第二步：使用补充证明解决冲突
      const resolvedResult = validator.resolveWithSupplementaryProof(
        [validProof, validProof2],
        validProof3,
        initialResultWithType
      );

      // 验证结果：应该需要人工审核
      expect(resolvedResult.isValid).toBe(false);
      expect(resolvedResult.needsManualReview).toBe(true);
      expect(resolvedResult.resolvedBy).toBe('manual');
    });
  });
});
