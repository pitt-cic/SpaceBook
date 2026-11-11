import { useState } from 'react';
import { calendarFeedUrl } from '../../api/calendarFeed';
import { useCalendarToken, useResetCalendarToken } from '../../hooks/useCalendarFeed';
import { useOperatingSite } from '../../hooks/useOperatingSite';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ToggleGroup } from '../ui/ToggleGroup';
import { ModalShell } from './ModalShell';

type Scope = 'site' | 'all';

interface Props {
  site: string;
  siteLabel: string;
  onClose: () => void;
}

// The signed-in staff member's private .ics subscription link
// (backend/lambda/calendar_feed). Outlook polls it, so changes show up on
// Outlook's schedule, not instantly.
export function CalendarSubscribeModal({ site, siteLabel, onClose }: Props) {
  const { accountSiteIds } = useOperatingSite();
  const { data, isLoading, error } = useCalendarToken();
  const reset = useResetCalendarToken();
  const [scope, setScope] = useState<Scope>('site');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const feedToken = data?.token ?? null;
  const multiSite = accountSiteIds.length > 1;
  const url = feedToken ? calendarFeedUrl(feedToken, multiSite && scope === 'site' ? site : undefined) : '';
  const errorMessage = (error ?? reset.error)?.message;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setAnnouncement('Link copied');
    } catch {
      setAnnouncement('Couldn’t copy. Select the link and copy it manually.');
    }
  }

  function createOrReset() {
    reset.mutate(undefined, {
      onSuccess: () => {
        setConfirmingReset(false);
        setAnnouncement(feedToken ? 'New link created. The old link no longer works.' : 'Link created');
      },
    });
  }

  let footer;
  if (!feedToken) {
    footer = (
      <>
        <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="w-auto text-sm px-3 py-1.5"
          onClick={createOrReset}
          isLoading={reset.isPending}
          disabled={isLoading}
        >
          Create link
        </Button>
      </>
    );
  } else if (confirmingReset) {
    footer = (
      <>
        <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={() => setConfirmingReset(false)}>
          Keep current link
        </Button>
        <Button className="w-auto text-sm px-3 py-1.5" onClick={createOrReset} isLoading={reset.isPending}>
          Reset link
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={() => setConfirmingReset(true)}>
          Reset link…
        </Button>
        <Button className="w-auto text-sm px-3 py-1.5" onClick={onClose}>
          Done
        </Button>
      </>
    );
  }

  return (
    <ModalShell title="Subscribe in Outlook" onClose={onClose} footer={footer}>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="space-y-4 text-sm text-ink-2">
        <p>
          Add SpaceBook’s approved bookings to your Outlook calendar. Outlook checks for changes every few hours, so a
          new or changed booking can take a while to show up there. SpaceBook stays the source of truth.
        </p>

        {errorMessage && (
          <p role="alert" className="rounded-lg bg-err-bg text-err-fg px-3 py-2">
            {errorMessage}
          </p>
        )}

        {isLoading && <p>Loading your link…</p>}

        {!isLoading && !feedToken && (
          <p>You don’t have a calendar link yet. Create one to get a private address to paste into Outlook.</p>
        )}

        {feedToken && (
          <>
            {multiSite && (
              <ToggleGroup
                label="Bookings to include"
                options={[
                  { value: 'site', label: siteLabel },
                  { value: 'all', label: 'All my sites' },
                ]}
                value={scope}
                onChange={setScope}
              />
            )}
            <div>
              <Input
                id="calendar-feed-url"
                label="Your private calendar link"
                readOnly
                data-autofocus
                value={url}
                onFocus={(e) => e.target.select()}
                hint="Anyone with this link can see these bookings, including requesters’ contact details. Don’t share it."
                className="font-mono text-xs"
              />
              <Button variant="secondary" className="w-auto mt-2 text-sm px-3 py-1.5" onClick={copy}>
                Copy link
              </Button>
            </div>

            {confirmingReset && (
              <p className="rounded-lg bg-warn-bg text-warn-fg px-3 py-2">
                Resetting creates a new link. Calendars subscribed with the current link stop updating, and you’ll need
                to subscribe again with the new one.
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-ink mb-1">Outlook on the web or new Outlook</h3>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Open Calendar and choose <strong>Add calendar</strong>.</li>
                <li>Choose <strong>Subscribe from web</strong> and paste the link.</li>
                <li>Name it (e.g. “SpaceBook”) and choose <strong>Import</strong>.</li>
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink mb-1">Classic Outlook for Windows</h3>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>
                  In Calendar, choose <strong>Add Calendar</strong> → <strong>From Internet</strong>.
                </li>
                <li>Paste the link and choose <strong>OK</strong>.</li>
              </ol>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
