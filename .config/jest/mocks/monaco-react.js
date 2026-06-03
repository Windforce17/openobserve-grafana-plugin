const React = require('react');
const monaco = require('monaco-editor');

const createFakeEditor = () => ({
  addCommand: jest.fn(),
  createContextKey: jest.fn(() => ({ reset: jest.fn(), set: jest.fn() })),
  dispose: jest.fn(),
  getModel: jest.fn(() => ({ id: 'jest-monaco-model' })),
  getValue: jest.fn(() => ''),
  layout: jest.fn(),
  onDidChangeModelContent: jest.fn(() => ({ dispose: jest.fn() })),
  setValue: jest.fn(),
  updateOptions: jest.fn(),
});

const Editor = ({ beforeMount, onMount, onChange, value = '', ...props }) => {
  React.useEffect(() => {
    beforeMount?.(monaco);
    onMount?.(createFakeEditor(), monaco);
  }, [beforeMount, onMount]);

  return React.createElement('textarea', {
    'data-testid': props['data-testid'] || 'zinc-editor-react-monaco-editor',
    value,
    onChange: (event) => onChange?.(event.target.value),
    readOnly: false,
  });
};

module.exports = Editor;
module.exports.default = Editor;
module.exports.Editor = Editor;
module.exports.DiffEditor = Editor;
module.exports.loader = { config: jest.fn(), init: jest.fn(() => Promise.resolve(monaco)) };
module.exports.useMonaco = jest.fn(() => monaco);
