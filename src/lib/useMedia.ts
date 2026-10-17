import { useEffect, useState } from 'react';

/** True while the CSS media query matches (e.g. the wide catalog layout). */
export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    window.addEventListener('resize', on); // fallback for environments that skip "change"
    return () => {
      mq.removeEventListener('change', on);
      window.removeEventListener('resize', on);
    };
  }, [query]);
  return matches;
}

