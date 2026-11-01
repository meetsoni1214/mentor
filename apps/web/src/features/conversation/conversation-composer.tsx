import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { ArrowUp } from 'lucide-react';
import { brand } from '../../brand/brand';

export function ConversationComposer() {
  return (
    <footer className="composer-region">
      <div className="composer-content">
        <div
          className="composer-box"
          role="group"
          aria-label="Message composer"
          aria-describedby="composer-availability"
        >
          <Label htmlFor="conversation-message" className="sr-only">
            Message {brand.name}
          </Label>
          <Textarea
            className="min-h-11 resize-none rounded-none border-0 p-0 shadow-none focus-visible:ring-0 disabled:opacity-100"
            id="conversation-message"
            placeholder={`Message ${brand.name}…`}
            rows={2}
            disabled
            aria-describedby="composer-availability"
          />
          <div className="composer-actions">
            <p id="composer-availability">Sending is not available yet.</p>
            <Button
              size="icon"
              type="button"
              disabled
              aria-label="Send message"
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}
