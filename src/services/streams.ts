import { getBackendSrv } from '@grafana/runtime';
import { OpenObserveStreamType } from '../types';

export function getStreams(url: string, orgName: string, streamType: OpenObserveStreamType = 'logs') {
  return new Promise((resolve, reject) =>
    getBackendSrv()
      .get(url + `/api/${orgName}/streams?type=${streamType}&fetchSchema=true`)
      .then((response) => {
        resolve(response);
      })
      .catch((err) => {
        reject(err);
      })
  );
}

export function getFieldValues({
  url,
  orgName,
  stream,
  fields,
  startTime,
  endTime,
  size = 50,
  keyword = '',
  noCount = false,
  streamType = 'logs',
}: {
  url: string;
  orgName: string;
  stream: string;
  fields: string;
  startTime: number;
  endTime: number;
  size?: number;
  keyword?: string;
  noCount?: boolean;
  streamType?: OpenObserveStreamType;
}) {
  const params = new URLSearchParams({
    fields,
    start_time: String(startTime),
    end_time: String(endTime),
    size: String(size),
    keyword,
    no_count: String(noCount),
    type: streamType,
  });

  return new Promise((resolve, reject) =>
    getBackendSrv()
      .get(url + `/api/${orgName}/${stream}/_values?${params.toString()}`)
      .then((response) => {
        resolve(response);
      })
      .catch((err) => {
        reject(err);
      })
  );
}
