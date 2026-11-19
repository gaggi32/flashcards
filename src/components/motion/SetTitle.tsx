// A set's title, named for view transitions: when one screen shows it and
// the next does too (its card in the list, the set's page, the study
// header), the title travels from one place to the other instead of the two
// screens simply swapping. Nothing happens on any other change.

import { ViewTransition, type ReactElement } from 'react';

export function SetTitle({ setId, children }: { setId: number; children: ReactElement }) {
  return (
    <ViewTransition name={`set-title-${setId}`} share="vt-morph" default="none" enter="none" exit="none" update="none">
      {children}
    </ViewTransition>
  );
}
