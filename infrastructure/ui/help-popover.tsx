'use client';

import { CircleHelp } from 'lucide-react';
import { getBuildInfo } from '@/application/build-info/get-build-info';
import { buildInfoAdapter } from '@/infrastructure/build-info/build-info-adapter';
import { Button } from './components/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/popover';

export function HelpPopover() {
  const { appName, version, commitHash } = getBuildInfo(buildInfoAdapter);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">App</dt>
            <dd className="font-medium">{appName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium">{version}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-medium">{commitHash}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
