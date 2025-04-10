import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  EventType,
  EventData,
  TaskMetrics,
  TimePoints,
  ValidationEventData,
  ConsensusEventData,
} from '../models/types';

export class MetricsCollector {
  private enabled: boolean = true;
  private events: EventData[] = [];
  private taskEventsIndex: Map<string, EventData[]> = new Map();
  private nodeEventsIndex: Map<string, EventData[]> = new Map();
  private systemStartTime: number;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.systemStartTime = Date.now();

    // 记录系统启动事件
    this.recordEvent({
      eventType: EventType.SYSTEM_START,
      timestamp: this.systemStartTime,
      metadata: { version: '1.0.0' },
    });
  }

  // 启用/禁用指标收集
  public enable(): void {
    this.enabled = true;
    logger.info('指标收集已启用');
  }

  public disable(): void {
    this.enabled = false;
    logger.info('指标收集已禁用');
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  // 核心事件记录方法
  public recordEvent(event: EventData): void {
    if (!this.enabled) return;

    // 添加事件ID
    const eventWithId = {
      ...event,
      id: event.id || uuidv4(),
      timestamp: event.timestamp || Date.now(),
    };

    // 记录事件
    this.events.push(eventWithId);

    // 更新任务索引
    if (event.taskId) {
      if (!this.taskEventsIndex.has(event.taskId)) {
        this.taskEventsIndex.set(event.taskId, []);
      }
      this.taskEventsIndex.get(event.taskId)!.push(eventWithId);
    }

    // 更新节点索引
    if (event.nodeId) {
      if (!this.nodeEventsIndex.has(event.nodeId)) {
        this.nodeEventsIndex.set(event.nodeId, []);
      }
      this.nodeEventsIndex.get(event.nodeId)!.push(eventWithId);
    }

    logger.debug(
      `记录事件: ${event.eventType}${event.taskId ? `, 任务: ${event.taskId}` : ''}${event.nodeId ? `, 节点: ${event.nodeId}` : ''}`
    );
  }

  // 专门用于记录验证事件的方法
  public recordValidationEvent(event: ValidationEventData): void {
    // 确保必须提供validationResult
    if (!event.validationResult) {
      console.warn(`尝试记录验证事件但缺少validationResult: ${event.eventType}`);
      return;
    }

    this.recordEvent(event);
  }

  // 专门用于记录共识事件的方法
  public recordConsensusEvent(event: ConsensusEventData): void {
    if (!event.ConsensusResult) {
      console.warn(`尝试记录共识事件但缺少consensusResult: ${event.eventType}`);
      return;
    }
    this.recordEvent(event);
  }

  // ====== 以下方法用于兼容旧API ======

  // 获取任务的时间点数据
  private getTaskTimePoints(taskId: string): TimePoints {
    const events = this.taskEventsIndex.get(taskId) || [];
    const timePoints: TimePoints = {};

    // 找出任务开始时间
    const startEvent = events.find(e => e.eventType === EventType.TASK_CREATED);
    if (startEvent) {
      timePoints.start = startEvent.timestamp;
    }

    // 提取所有时间点事件
    events.forEach(event => {
      if (event.metadata?.timePoint) {
        timePoints[event.metadata.timePoint] = event.timestamp;
      }

      // 特殊事件类型映射到时间点
      switch (event.eventType) {
        case EventType.CONSENSUS_STARTED:
          timePoints.consensusStart = event.timestamp;
          break;
        case EventType.CONSENSUS_REACH_NORMAL:
          timePoints.consensusEnd = event.timestamp;
          break;
        case EventType.TASK_COMPLETED:
          timePoints.end = event.timestamp;
          break;
      }
    });

    return timePoints;
  }

  // 获取单个任务的指标 (兼容旧API)
  public getTaskMetrics(taskId: string): TaskMetrics | undefined {
    const events = this.taskEventsIndex.get(taskId);
    if (!events || events.length === 0) return undefined;

    // 排序事件
    events.sort((a, b) => a.timestamp - b.timestamp);

    // 找出首个和最后事件
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    // 找出创建事件
    const createEvent = events.find(e => e.eventType === EventType.TASK_CREATED);
    if (!createEvent) return undefined;

    // 查找完成事件
    const completeEvent = events.find(e => e.eventType === EventType.TASK_COMPLETED);
    const failEvent = events.find(e => e.eventType === EventType.TASK_FAILED);

    // 确定任务状态
    let status: 'pending' | 'running' | 'completed' | 'failed' = 'running';
    if (completeEvent) status = 'completed';
    if (failEvent) status = 'failed';

    // 获取任务类型
    const taskType = createEvent.metadata?.taskType || 'unknown';

    // 构建任务指标
    const metrics: TaskMetrics = {
      taskId,
      taskType,
      startTime: createEvent.timestamp,
      status,
      timePoints: this.getTaskTimePoints(taskId),
    };

    // 添加结束信息
    if (completeEvent) {
      metrics.endTime = completeEvent.timestamp;
      metrics.duration = completeEvent.timestamp - createEvent.timestamp;
      metrics.taskResults = completeEvent.metadata?.results;
    }

    if (failEvent) {
      metrics.endTime = failEvent.timestamp;
      metrics.duration = failEvent.timestamp - createEvent.timestamp;
      metrics.error = failEvent.metadata?.error;
    }

    return metrics;
  }

  // 获取所有任务指标 (兼容旧API)
  public getAllTaskMetrics(): TaskMetrics[] {
    return Array.from(this.taskEventsIndex.keys())
      .map(taskId => this.getTaskMetrics(taskId))
      .filter((metrics): metrics is TaskMetrics => metrics !== undefined);
  }

  // 获取系统指标 (兼容旧API)
  public getSystemMetrics(): Record<string, any> {
    // 统计数据
    const taskEvents = this.events.filter(e => e.taskId);
    const taskIds = new Set(taskEvents.map(e => e.taskId));

    const completedTasks = new Set();
    const failedTasks = new Set();

    // 计算成功和失败任务
    this.events.forEach(event => {
      if (!event.taskId) return;

      if (event.eventType === EventType.TASK_COMPLETED) {
        completedTasks.add(event.taskId);
      } else if (event.eventType === EventType.TASK_FAILED) {
        failedTasks.add(event.taskId);
      }
    });

    return {
      startTime: this.systemStartTime,
      uptime: Date.now() - this.systemStartTime,
      taskCount: taskIds.size,
      successCount: completedTasks.size,
      failureCount: failedTasks.size,
      eventCount: this.events.length,
    };
  }

  // 获取所有指标 (兼容旧API)
  public getAllMetrics(): {
    system: Record<string, any>;
    tasks: TaskMetrics[];
    eventSummary?: any;
  } {
    const metrics = {
      system: this.getSystemMetrics(),
      tasks: this.getAllTaskMetrics(),
    };

    // 添加事件摘要信息
    if (this.events.length > 0) {
      const eventTypes: Record<string, number> = {};
      this.events.forEach(event => {
        if (!eventTypes[event.eventType]) {
          eventTypes[event.eventType] = 0;
        }
        eventTypes[event.eventType]++;
      });

      return {
        ...metrics,
        eventSummary: {
          totalEvents: this.events.length,
          eventTypeDistribution: eventTypes,
          firstEventTime: this.events[0].timestamp,
          lastEventTime: this.events[this.events.length - 1].timestamp,
        },
      };
    }

    return metrics;
  }

  // 清除特定任务指标
  public clearTaskMetrics(taskId: string): boolean {
    if (!this.taskEventsIndex.has(taskId)) return false;

    // 获取该任务的所有事件
    const taskEvents = this.taskEventsIndex.get(taskId) || [];

    // 从事件数组中移除
    this.events = this.events.filter(event => event.taskId !== taskId);

    // 从任务索引中移除
    this.taskEventsIndex.delete(taskId);

    // 从节点索引中移除该任务的事件
    for (const [nodeId, events] of this.nodeEventsIndex.entries()) {
      this.nodeEventsIndex.set(
        nodeId,
        events.filter(event => event.taskId !== taskId)
      );
    }

    logger.debug(`已清除任务 ${taskId} 的指标数据，移除了 ${taskEvents.length} 个事件`);
    return true;
  }

  // 清除所有指标
  public clearAllMetrics(): void {
    const oldEventCount = this.events.length;
    this.events = [];
    this.taskEventsIndex.clear();
    this.nodeEventsIndex.clear();
    this.systemStartTime = Date.now();

    // 记录系统重置事件
    this.recordEvent({
      eventType: EventType.SYSTEM_START,
      timestamp: this.systemStartTime,
      metadata: { reset: true },
    });

    logger.debug(`已清除所有指标数据，共移除 ${oldEventCount} 个事件`);
  }

  // ====== 新增高级API ======

  // 获取特定任务的所有事件
  public getTaskEvents(taskId: string): EventData[] {
    return [...(this.taskEventsIndex.get(taskId) || [])].sort((a, b) => a.timestamp - b.timestamp);
  }

  // 获取特定节点的所有事件
  public getNodeEvents(nodeId: string): EventData[] {
    return [...(this.nodeEventsIndex.get(nodeId) || [])].sort((a, b) => a.timestamp - b.timestamp);
  }

  // 获取指定类型的所有事件
  public getEventsByType(eventType: EventType): EventData[] {
    return this.events
      .filter(event => event.eventType === eventType)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // 生成任务的详细执行时间线
  public generateTaskTimeline(taskId: string): any {
    const events = this.getTaskEvents(taskId);
    if (events.length === 0) return null;

    // 按时间排序
    events.sort((a, b) => a.timestamp - b.timestamp);

    // 构建时间线
    const timeline = events.map(event => ({
      timestamp: event.timestamp,
      eventType: event.eventType,
      nodeId: event.nodeId,
      metadata: event.metadata,
    }));

    // 计算各阶段耗时
    // const phases = this.calculateTaskPhases(events);

    return {
      taskId,
      timeline,
      // phases,
      totalDuration: events[events.length - 1].timestamp - events[0].timestamp,
    };
  }

  // 计算任务各阶段耗时
  // private calculateTaskPhases(events: EventData[]): any {
  //   const phases: Record<string, { start?: number; end?: number; duration?: number }> = {};

  //   // 查找各阶段边界事件
  //   const findPhaseEvents = (
  //     startType: EventType,
  //     endType: EventType
  //   ): { start?: EventData; end?: EventData } => {
  //     return {
  //       start: events.find(e => e.eventType === startType),
  //       end: events.find(e => e.eventType === endType),
  //     };
  //   };

  //   // 初始化阶段
  //   const initPhase = findPhaseEvents(EventType.TASK_CREATED, EventType.PROOF_RECEIVED);
  //   if (initPhase.start) {
  //     phases.initialization = {
  //       start: initPhase.start.timestamp,
  //       end: initPhase.end?.timestamp,
  //       duration: initPhase.end ? initPhase.end.timestamp - initPhase.start.timestamp : undefined,
  //     };
  //   }

  //   // 共识阶段
  //   const consensusPhase = findPhaseEvents(
  //     EventType.CONSENSUS_STARTED,
  //     EventType.CONSENSUS_REACHED
  //   );
  //   if (consensusPhase.start) {
  //     phases.consensus = {
  //       start: consensusPhase.start.timestamp,
  //       end: consensusPhase.end?.timestamp,
  //       duration: consensusPhase.end
  //         ? consensusPhase.end.timestamp - consensusPhase.start.timestamp
  //         : undefined,
  //     };
  //   }

  //   // 完成阶段
  //   const finalPhase = findPhaseEvents(EventType.CONSENSUS_REACHED, EventType.TASK_COMPLETED);
  //   if (finalPhase.start) {
  //     phases.finalization = {
  //       start: finalPhase.start.timestamp,
  //       end: finalPhase.end?.timestamp,
  //       duration: finalPhase.end
  //         ? finalPhase.end.timestamp - finalPhase.start.timestamp
  //         : undefined,
  //     };
  //   }

  //   return phases;
  // }

  // 获取所有事件
  public getAllEvents(): EventData[] {
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  // 查询指定时间段内的事件
  public queryEventsByTimeRange(startTime: number, endTime: number): EventData[] {
    return this.events
      .filter(event => event.timestamp >= startTime && event.timestamp <= endTime)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
