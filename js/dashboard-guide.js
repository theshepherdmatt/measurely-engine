// js/dashboard-guide.js

import { createTour } from './tour.js';
import { dashboardSteps } from './dashboard-tour.js';

const tour = createTour(dashboardSteps, {
  onEnd() {},
});

window.startDashboardTour = () => tour.start(0);

// Auto-start if arriving from the onboarding wizard.
// The flag is cleared immediately so a page refresh doesn't re-trigger it.
if (localStorage.getItem('measurely_continue_tour')) {
  localStorage.removeItem('measurely_continue_tour');
  // Small delay lets the dashboard JS finish its initial data fetch / render.
  setTimeout(() => tour.start(0), 1000);
}
