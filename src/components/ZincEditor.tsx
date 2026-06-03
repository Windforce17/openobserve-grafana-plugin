import React from 'react';
import { css } from '@emotion/css';
import { ReactMonacoEditor, monacoTypes } from '@grafana/ui';

interface Props {
  query: string;
  onChange: ({ value, sqlMode }: { value: string; sqlMode: boolean }) => void;
  placeholder: string;
  getFields: any;
  runQuery: () => void;
  isSQLMode: boolean;
  id: string;
  timestamp_column: string | undefined;
}

export const ZincEditor = ({ query, onChange, getFields, runQuery, isSQLMode, id, timestamp_column }: Props): any => {
  const options: monacoTypes.editor.IStandaloneEditorConstructionOptions = {
    wordWrap: 'on',
    lineNumbers: 'on',
    lineNumbersMinChars: 0,
    overviewRulerLanes: 0,
    fixedOverflowWidgets: false,
    overviewRulerBorder: false,
    lineDecorationsWidth: 3,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: 'none',
    glyphMargin: false,
    folding: false,
    scrollBeyondLastColumn: 0,
    scrollBeyondLastLine: true,
    scrollbar: { horizontal: 'auto', vertical: 'visible' },
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: 'never',
      seedSearchStringFromSelection: 'never',
    },
    minimap: { enabled: false },
  };

  const SQL_KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'ORDER BY',
    'GROUP BY',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'AS',
    'ASC',
    'DESC',
    'DISTINCT',
    'NOT',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'UNION ALL',
  ];

  const SQL_FUNCTIONS = [
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'histogram',
    'approx_distinct',
    'str_match',
    'str_match_ignore_case',
    'to_timestamp',
  ];

  const createDependencyProposals = (range: any, monaco: any) => {
    const keywords = [
      ...SQL_KEYWORDS.map((keyword) => ({
        label: keyword,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: `${keyword} `,
        range: range,
      })),
      ...SQL_FUNCTIONS.map((fn) => ({
        label: fn,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: `${fn}(\${1:})`,
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      })),
      {
        label: 'and',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: 'and ',
        range: range,
      },
      {
        label: 'or',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: 'or ',
        range: range,
      },
      {
        label: 'like',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: "like '%${1:params}%' ",
        range: range,
      },
      {
        label: 'in',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: "in ('${1:params}') ",
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
      {
        label: 'not in',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: "not in ('${1:params}') ",
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
      {
        label: 'between',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: "between '${1:params}' and '${1:params}' ",
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
      {
        label: 'not between',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: "not between '${1:params}' and '${1:params}' ",
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
      {
        label: 'is null',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: 'is null ',
        range: range,
      },
      {
        label: 'is not null',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: 'is not null ',
        range: range,
      },
      {
        label: '>',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '> ',
        range: range,
      },
      {
        label: '<',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '< ',
        range: range,
      },
      {
        label: '>=',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '>= ',
        range: range,
      },
      {
        label: '<=',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '<= ',
        range: range,
      },
      {
        label: '<>',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '<> ',
        range: range,
      },
      {
        label: '=',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '= ',
        range: range,
      },
      {
        label: '!=',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: '!= ',
        range: range,
      },
      {
        label: '()',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: '(${1:condition}) ',
        range: range,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
    ];

    (getFields || []).forEach((field: any) => {
      if (!field?.name || field.name === (timestamp_column || '_timestamp')) {
        return;
      }
      let itemObj = {
        label: field.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: field.name,
        range: range,
        detail: field.type ? String(field.type) : 'column',
      };
      keywords.push(itemObj);
    });

    return keywords;
  };

  const onEditorMount = (editor: any, monaco: any) => {
    const completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: function (model: any, position: any) {
        if (editor.getModel()?.id !== model.id) {
          return {
            suggestions: [],
          };
        }
        // find out if we are completing a property in the 'dependencies' object.
        let textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        let word = model.getWordUntilPosition(position);
        let range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        let arr = textUntilPosition.trim().split(' ');
        let filteredSuggestions = [];
        filteredSuggestions = createDependencyProposals(range, monaco);
        filteredSuggestions = filteredSuggestions.filter((item) => {
          return item.label.toLowerCase().includes(word.word.toLowerCase());
        });

        // if (filteredSuggestions.length == 0) {
        const lastElement = arr.pop();

        filteredSuggestions.push({
          label: `match_all('${lastElement}')`,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: `match_all('${lastElement}')`,
          range: range,
        });
        filteredSuggestions.push({
          label: `match_all_ignore_case('${lastElement}')`,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: `match_all_ignore_case('${lastElement}')`,
          range: range,
        });

        return {
          suggestions: filteredSuggestions,
        };
      },
    });

    editor.createContextKey('ctrlenter', true);
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      function () {
        runQuery();
      },
      'ctrlenter'
    );

    const onWindowClick = () => editor.layout();
    window.addEventListener('click', onWindowClick);

    // Dispose the completion provider and listeners when this editor instance goes away,
    // otherwise every remount would register another provider and duplicate suggestions.
    editor.onDidDispose?.(() => {
      completionProvider?.dispose?.();
      window.removeEventListener('click', onWindowClick);
    });
  };

  const onChangeQuery = (value: any) => {
    onChange({
      value,
      sqlMode: isSQLMode,
    });
  };

  return (
    <ReactMonacoEditor
      data-testid="zinc-editor-react-monaco-editor"
      options={options}
      onMount={onEditorMount}
      value={query}
      language="sql"
      className={css`
        height: 100px;
        max-height: 200px;
      `}
      onChange={onChangeQuery}
      saveViewState={false}
      keepCurrentModel={false}
    ></ReactMonacoEditor>
  );
};
