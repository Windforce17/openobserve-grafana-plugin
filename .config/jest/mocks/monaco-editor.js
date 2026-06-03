module.exports = {
  Uri: {
    parse: jest.fn((value) => ({ path: value, toString: () => value })),
  },
  editor: {
    createModel: jest.fn(() => ({
      dispose: jest.fn(),
      getValue: jest.fn(() => ''),
      onDidChangeContent: jest.fn(() => ({ dispose: jest.fn() })),
      setValue: jest.fn(),
      updateOptions: jest.fn(),
    })),
    getModel: jest.fn(() => null),
    onDidChangeMarkers: jest.fn(() => ({ dispose: jest.fn() })),
    create: jest.fn(() => ({
      addCommand: jest.fn(),
      createContextKey: jest.fn(() => ({ reset: jest.fn(), set: jest.fn() })),
      dispose: jest.fn(),
      getModel: jest.fn(),
      getValue: jest.fn(() => ''),
      layout: jest.fn(),
      onDidChangeModelContent: jest.fn(() => ({ dispose: jest.fn() })),
      setValue: jest.fn(),
      updateOptions: jest.fn(),
    })),
    defineTheme: jest.fn(),
    remeasureFonts: jest.fn(),
    setTheme: jest.fn(),
  },
  KeyMod: {
    CtrlCmd: 2048,
  },
  KeyCode: {
    Enter: 3,
  },
  languages: {
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
    CompletionItemKind: {
      Keyword: 17,
      Operator: 11,
      Text: 1,
    },
    register: jest.fn(),
    setMonarchTokensProvider: jest.fn(),
    setLanguageConfiguration: jest.fn(),
    registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  },
};
