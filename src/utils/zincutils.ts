import { FieldType } from '@grafana/data';
import { config } from '@grafana/runtime';

export const logsErrorMessage = (code: number) => {
  const messages: any = {
    10001: 'ServerInternalError',
    20001: 'SearchSQLNotValid',
    20002: 'SearchStreamNotFound',
    20003: 'FullTextSearchFieldNotFound',
    20004: 'SearchFieldNotFound',
    20005: 'SearchFunctionNotDefined',
    20006: 'SearchParquetFileNotFound',
    20007: 'SearchFieldHasNoCompatibleDataType',
  };

  if (messages[code] !== undefined) {
    return 'message.' + messages[code];
  } else {
    return '';
  }
};

export const convertTimeToMs = (time: number) => {
  const nanoseconds = time;
  const milliseconds = Math.floor(nanoseconds / 1000);
  const date = new Date(milliseconds);
  return date.getTime();
};

export const getTheme = () => {
  return config.bootData.user.theme;
};

export const getConsumableTime = (range: any) => {
  const startTimeInMicro: any = new Date(new Date(range!.from.valueOf()).toISOString()).getTime() * 1000;
  const endTimeInMirco: any = new Date(new Date(range!.to.valueOf()).toISOString()).getTime() * 1000;
  return {
    startTimeInMicro,
    endTimeInMirco,
  };
};

const COMPARE_UNIT_MICROS: Record<string, number> = {
  s: 1_000_000,
  m: 60 * 1_000_000,
  h: 60 * 60 * 1_000_000,
  d: 24 * 60 * 60 * 1_000_000,
  w: 7 * 24 * 60 * 60 * 1_000_000,
};

/**
 * Parses a per-target comparison offset into microseconds. This drives "compare to a previous
 * period" overlays: the target's start_time/end_time are shifted back by this amount so the API
 * call is still partition-pruned (fast), and the returned timestamps are shifted forward by the
 * same amount so the previous-period series lines up on the current time axis.
 *
 * Accepted forms (empty / "0" / "none" all mean "no offset"):
 *   "1d", "7d", "1w", "1h", "30m", "90s"   duration with a unit (s/m/h/d/w)
 *   "86400000000"                          a bare integer is treated as microseconds
 */
export const parseCompareOffsetMicros = (offset?: string | number | null): number => {
  if (offset === null || offset === undefined) {
    return 0;
  }
  if (typeof offset === 'number') {
    return Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
  }

  const raw = offset.trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'none') {
    return 0;
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  // No unit => the number is already in microseconds; otherwise scale by the unit.
  const unit = match[2];
  return Math.trunc(unit ? value * COMPARE_UNIT_MICROS[unit] : value);
};

export const getFieldType = (type: string) => {
  const fieldsMapping: { [key: string]: FieldType } = {
    Utf8: FieldType.string,
    Int64: FieldType.number,
    timestamp: FieldType.time,
  };

  return fieldsMapping[type];
};
