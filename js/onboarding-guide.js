// onboarding-guide.js
// Vanilla JS tour integration — no React or external dependencies.

import { createTour } from './tour.js';
import { onboardingSteps, wizardToJoyrideStep } from './onboarding-tour.js';

// Set to true while advanceWizard is in flight so syncTourToWizard
// doesn't fight the async goTo we're about to call ourselves.
let wizardAdvancing = false;

const tour = createTour(onboardingSteps, {

  onNext(index, step) {
    if (step.data?.advanceWizard) {
      // Last tour step: flag so the dashboard tour auto-starts after navigation.
      if (index === onboardingSteps.length - 1) {
        localStorage.setItem('measurely_continue_tour', '1');
      }

      // Advance the wizard page, then advance the tour once the new DOM is ready.
      wizardAdvancing = true;
      window.advanceWizard?.();
      const next = index + 1;
      setTimeout(() => {
        wizardAdvancing = false;
        tour.goTo(next);
      }, 80);

      return false; // suppress tour's built-in auto-advance
    }

    // Pre-scroll the next step's target into view before the tooltip moves.
    const nextStep = onboardingSteps[index + 1];
    if (nextStep?.target) {
      document.querySelector(nextStep.target)?.scrollIntoView({ block: 'nearest' });
    }
    // Return undefined — tour advances normally.
  },

  onEnd() {
    // Nothing needed; the wizard manages its own state.
  },
});

window.startTour = () => tour.start(0);

// Called by loadStep() whenever the wizard page changes manually,
// so the tour jumps to the right phase if the user navigated by hand.
window.syncTourToWizard = (wizardStep) => {
  if (!tour.isRunning() || wizardAdvancing) return;
  if (wizardStep in wizardToJoyrideStep) {
    tour.goTo(wizardToJoyrideStep[wizardStep]);
  }
};
