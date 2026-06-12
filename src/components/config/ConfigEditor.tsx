import React from 'react';
import { Field, InlineLabel, Input } from '@grafana/ui';
import { AdvancedHttpSettings, Auth, ConfigSection, ConnectionSettings, convertLegacyAuthProps } from '@grafana/plugin-ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions } from '../../types';
import { css } from '@emotion/css';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions> {}

type JsonSettingKey = keyof Pick<
  MyDataSourceOptions,
  | 'timestamp_column'
  | 'default_organization'
  | 'default_log_stream'
  | 'default_trace_stream'
  | 'trace_id_field'
  | 'span_id_field'
  | 'service_name_field'
  | 'span_name_field'
  | 'status_field'
  | 'duration_field'
>;

const OPENOBSERVE_DEFAULTS: Record<JsonSettingKey, string> = {
  timestamp_column: '_timestamp',
  default_organization: 'default',
  default_log_stream: '',
  default_trace_stream: '',
  trace_id_field: 'trace_id',
  span_id_field: 'span_id',
  service_name_field: 'service_name',
  span_name_field: 'operation_name',
  status_field: 'status_code',
  duration_field: 'duration',
};

const settingsGrid = css`
  display: grid;
  grid-template-columns: minmax(140px, max-content) minmax(220px, 360px);
  gap: 8px 12px;
  align-items: start;
`;

const helperText = css`
  color: var(--text-secondary);
  max-width: 680px;
  margin: 0 0 16px;
`;

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;

  const getJsonSetting = (key: JsonSettingKey) => options.jsonData?.[key] ?? OPENOBSERVE_DEFAULTS[key];

  const updateJsonSetting = (key: JsonSettingKey, value: string) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        [key]: value,
      },
    });
  };

  const renderSetting = (key: JsonSettingKey, label: string, placeholder?: string, required = false) => {
    const value = getJsonSetting(key);
    const invalid = required && value.trim() === '';

    return (
      <React.Fragment key={key}>
        <InlineLabel className="width-14">{label}</InlineLabel>
        <Field invalid={invalid} error={invalid ? `${label} cannot be empty` : ''}>
          <Input
            className="width-28"
            value={value}
            placeholder={placeholder ?? OPENOBSERVE_DEFAULTS[key]}
            onChange={(event) => updateJsonSetting(key, event.currentTarget.value)}
          />
        </Field>
      </React.Fragment>
    );
  };

  return (
    <div>
      <ConnectionSettings config={options} onChange={onOptionsChange} urlPlaceholder="http://localhost:9200" />
      <Auth {...convertLegacyAuthProps({ config: options, onChange: onOptionsChange })} />
      <ConfigSection title="Advanced settings" isCollapsible>
        <AdvancedHttpSettings config={options} onChange={onOptionsChange} />
      </ConfigSection>
      <ConfigSection title="OpenObserve query defaults">
        <p className={helperText}>
          Configure separate defaults for log and trace workflows. These defaults are used by the query editor when a new
          query is created, and the trace field mappings drive trace search and the drill-down into a single trace. The
          default log/trace streams and the Trace ID field also power the log&nbsp;&harr;&nbsp;trace links: logs jump to a
          trace using the default trace stream, and a trace jumps to its correlated logs using the default log stream.
        </p>
        <div className={settingsGrid}>
          {renderSetting('timestamp_column', 'Time field name', '_timestamp', true)}
          {renderSetting('default_organization', 'Default organization', 'default')}
          {renderSetting('default_log_stream', 'Default log stream', 'default')}
          {renderSetting('default_trace_stream', 'Default trace stream', 'default')}
          {renderSetting('trace_id_field', 'Trace ID field', 'trace_id', true)}
          {renderSetting('span_id_field', 'Span ID field', 'span_id', true)}
          {renderSetting('service_name_field', 'Service field', 'service_name', true)}
          {renderSetting('span_name_field', 'Span field', 'operation_name', true)}
          {renderSetting('status_field', 'Status field', 'status_code', true)}
          {renderSetting('duration_field', 'Duration field', 'duration', true)}
        </div>
      </ConfigSection>
    </div>
  );
}
