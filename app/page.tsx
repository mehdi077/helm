'use client';

import { useState, useEffect, useCallback } from 'react';
import { debounce } from 'lodash';
import TiptapEditor from '../components/TiptapEditor';

export default function Home() {
  const [content, setContent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const DOC_ID = 'infinite-doc-v1';

  useEffect(() => {
    // Load from API on mount
    async function loadDoc() {
      try {
        const res = await fetch(`/api/doc?id=${DOC_ID}`);
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setContent(data);
          }
        }
      } catch (e) {
        console.error('Failed to load doc', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadDoc();
  }, []);

  // Debounced save function
  const saveContent = useCallback(
    debounce(async (newContent: any) => {
      try {
        await fetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: DOC_ID, content: newContent }),
        });
        console.log('Saved to server');
      } catch (e) {
        console.error('Failed to save doc', e);
      }
    }, 1000),
    []
  );

  const handleUpdate = (newContent: any) => {
    saveContent(newContent);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl mb-4 text-gray-400">Infinite Document</h1>
        <TiptapEditor initialContent={content} onContentUpdate={handleUpdate} />
      </div>
    </main>
  );
}
