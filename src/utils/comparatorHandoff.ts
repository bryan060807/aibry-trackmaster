export interface ComparatorHandoffPayload {
  source: 'trackmaster';
  title?: string;
  notes?: string;
  createdAt: string;
}

export function buildComparatorHandoffUrl(notes?: string) {
  const payload: ComparatorHandoffPayload = {
    source: 'trackmaster',
    title: 'TrackMaster export handoff',
    notes,
    createdAt: new Date().toISOString(),
  };

  const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
  const url = new URL('https://comparator.aibry.shop/');
  url.searchParams.set('tmHandoff', encoded);
  return url.toString();
}
