import { useEffect } from 'react';

// Names the browser tab for a page; leaving the page gives the title back.
export const usePageTitle = (title: string) => {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
};
