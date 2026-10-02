/**
 * 额度水位条（原 QuotaProgressBar 的类型化后继）。
 *
 * dataviz 语法：细轨道退居背景，填充按剩余量三档着色（≥70 绿 / ≥30 琥珀 / <30 红），
 * percent === null 渲染空轨道 —— 未知不着色（Medium 类在 width 0 下不可见，行为与旧版一致）。
 * `index` 写入 `--meter-index`，供全页外衣做逐行入场级差；紧凑外衣不消费该变量。
 *
 * The thresholds are a prop so the Ledger layout can use its own (75 / 40)
 * without a second meter; the card view keeps the defaults (see meterLevel.ts).
 */

import type { CSSProperties } from 'react';
import type { QuotaClassMap } from '../types';
import { clampPercent, resolveQuotaMeterLevel, type QuotaMeterThresholds } from '../meterLevel';

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
  index?: number;
  thresholds?: QuotaMeterThresholds;
}

export function QuotaMeter({ percent, classes, index, thresholds }: QuotaMeterProps) {
  const normalized = percent === null ? null : clampPercent(percent);
  const level = resolveQuotaMeterLevel(normalized, thresholds);
  const fillClass =
    level === 'high'
      ? classes.quotaBarFillHigh
      : level === 'low'
        ? classes.quotaBarFillLow
        : classes.quotaBarFillMedium;
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;
  const style: CSSProperties & { '--meter-index'?: number } = { width: `${widthPercent}%` };
  if (index !== undefined) {
    style['--meter-index'] = index;
  }

  return (
    <div className={classes.quotaBar}>
      <div className={`${classes.quotaBarFill} ${fillClass}`} style={style} />
    </div>
  );
}
