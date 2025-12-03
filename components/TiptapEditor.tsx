'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { useEffect, useState } from 'react';
import { ChevronRight, ChevronLeft, Bold, Highlighter, Palette } from 'lucide-react';

interface TiptapEditorProps {
  initialContent: any;
  onContentUpdate: (content: any) => void;
}

const TiptapEditor = ({ initialContent, onContentUpdate }: TiptapEditorProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Force re-render on editor updates to reflect active states in toolbar
  const [, forceUpdate] = useState({});
  
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
    ],
    content: initialContent || '<p>> </p>',
    onUpdate: ({ editor }) => {
      onContentUpdate(editor.getJSON());
    },
    onSelectionUpdate: () => {
       forceUpdate({});
    },
    onTransaction: () => {
       forceUpdate({});
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-screen p-8 text-white',
      },
    },
  });

  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
       // Content init logic
    }
  }, [initialContent, editor]);

  if (!editor) {
    return null;
  }

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex w-full min-h-screen bg-black text-white relative">
      {/* Sidebar */}
      <div 
        className={`fixed top-0 right-0 h-full bg-zinc-900 border-l border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isSidebarOpen ? 'w-64' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-6 w-64">
          <h2 className="text-lg font-semibold text-zinc-400 border-b border-zinc-700 pb-2">Tools</h2>
          
          {/* Bold Control */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm"><Bold size={16} /> Bold</span>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${editor.isActive('bold') ? 'bg-blue-600' : 'bg-zinc-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${editor.isActive('bold') ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Color Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Palette size={16} /> Text Color</span>
            <div className="flex gap-2 flex-wrap">
              {['#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('textStyle', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Highlight Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Highlighter size={16} /> Highlight</span>
            <div className="flex gap-2 flex-wrap">
              <button
                  type="button"
                  onClick={() => editor.chain().focus().unsetHighlight().run()}
                  className="px-2 py-1 text-xs bg-zinc-800 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition-colors"
              >
                None
              </button>
              {['#facc15', '#4ade80', '#60a5fa', '#f472b6'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('highlight', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        type="button"
        onClick={toggleSidebar}
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-l-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isSidebarOpen ? 'right-64' : 'right-0'
        }`}
      >
        {isSidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      {/* Editor Area */}
      <div className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'mr-64' : ''}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default TiptapEditor;
