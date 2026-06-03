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

export const getFieldType = (type: string) => {
  const fieldsMapping: { [key: string]: FieldType } = {
    Utf8: FieldType.string,
    Int64: FieldType.number,
    timestamp: FieldType.time,
  };

  return fieldsMapping[type];
};
