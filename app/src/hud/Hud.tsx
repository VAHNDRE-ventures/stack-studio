import { Eye } from 'lucide-react';
import { useStudio } from '../store';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { LensDrawer } from './LensDrawer';
import { BottomDock } from './BottomDock';

/** The DOM HUD frame: slim top bar, left icon rail + one-lens drawer, bottom control dock.
 *  Clean view collapses everything to just the city with a single restore affordance. */
export function Hud() {
  const cleanView = useStudio((s) => s.cleanView);
  const toggleCleanView = useStudio((s) => s.toggleCleanView);

  if (cleanView) {
    return (
      <button
        type="button"
        className="clean-restore"
        onClick={toggleCleanView}
        title="Show controls"
        aria-label="Show controls"
      >
        <Eye size={18} />
      </button>
    );
  }

  return (
    <>
      <TopBar />
      <IconRail />
      <LensDrawer />
      <BottomDock />
    </>
  );
}
