import { Mark, mergeAttributes } from '@tiptap/core';

export interface CompletionMarkOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    completionMark: {
      setCompletionMark: () => ReturnType;
      unsetCompletionMark: () => ReturnType;
    };
  }
}

export const CompletionMark = Mark.create<CompletionMarkOptions>({
  name: 'completionMark',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-completion]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-completion': 'true', class: 'completion-ghost' }), 0];
  },

  addCommands() {
    return {
      setCompletionMark:
        () =>
        ({ commands }) => {
          return commands.setMark(this.name);
        },
      unsetCompletionMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
