import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  getLaunchState,
  REGISTRATION_CONFIRMATION_COPY,
  REGISTRATION_CONFIRMATION_TITLE,
} from '../../shared/launch-state.js';

const FamHack = {
  config: {
    otpLength: 6,
    otpResendDelay: 30,
    maxTeamSize: 15,
    ctfLeaderboardVisibleCount: 5,
  },

  state: {
    page: null,
    launch: null,
    session: null,
    registration: null,
    registrationStatus: null,
    pendingEmail: '',
    registerIntent: 'role',
    childFocus: '',
    childJoinMode: '',
    parentTeamKind: 'family',
    teamPreview: null,
    resendTimer: null,
    joinLookupTimer: null,
    logoJitterElement: null,
    logoResetTimer: null,
    logoLastPointerX: null,
    logoLastPointerY: null,
    participateDestination: null,
    participateLabel: null,
    participateCheckPromise: null,
    dashboard: null,
    ctf: null,
    ctfPendingAdvanceState: null,
    ctfRecentKeys: [],
    ctfKonamiBusy: false,
    ctfKonamiRetry: false,
    ctfKonamiSolved: false,
    ctfAdvanceTimer: null,
    ctfSigintModalOpen: false,
    ctfFinalInfoModalOpen: false,
    ctfFinalChallengeEligible: false,
    ctfFinalRevealComplete: false,
    ctfFinalScrollCleanup: null,
    ctfSigintConsoleHintLogged: false,
    homeClockFrame: null,
    homeClockTimer: null,
    homeFaq: null,
    parentInviteToken: '',
    familyInviteActive: false,
    inviteLetterOpen: false,
  },

  async init() {
    this.state.page = this.getPage();
    this.state.launch = getLaunchState();
    this.initOTPInputs();
    this.initNavigation();

    if (!this.state.page) {
      return;
    }

    if (this.state.page === 'home') {
      this.initHomePageBase();
    }

    try {
      const publicConfig = await this.fetchConfig();
      this.config = {
        ...this.config,
        ...publicConfig,
      };
      this.state.launch = publicConfig.launch || this.state.launch || getLaunchState();

      this.supabase = createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          storageKey: 'famhack-auth',
        },
      });

      this.supabase.auth.onAuthStateChange((_event, session) => {
        this.state.session = session;
        this.state.participateDestination = null;
        this.state.participateLabel = null;
        if (!session) {
          this.resetAuthFlowState();
        }
      });

      await this.hydrateSession();
      this.captureParentInviteToken();
      this.captureFamilyInviteFlag();

      if (this.state.page === 'home') {
        await this.initHomePage();
      } else if (this.state.page === 'register') {
        await this.initRegisterPage();
      } else if (this.state.page === 'join') {
        await this.initJoinPage();
      } else if (this.state.page === 'ctf') {
        await this.initCtfPage();
      } else if (this.state.page === 'dashboard') {
        await this.initDashboardPage();
      }
    } catch (error) {
      const isLocalHomeConfigFailure = this.state.page === 'home'
        && (error?.code === 'CONFIG_UNAVAILABLE' || error?.code === 'CONFIG_INVALID');

      if (isLocalHomeConfigFailure) {
        return;
      }

      console.error(error);
      this.showFatalError(error.message || 'Unable to load the registration flow right now.');
    }
  },

  getPage() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path.endsWith('/index.html')) return 'home';
    if (path === '/register' || path.endsWith('/register.html')) return 'register';
    if (path === '/join' || path.endsWith('/join.html')) return 'join';
    if (path === '/ctf' || path.endsWith('/ctf.html')) return 'ctf';
    if (path === '/dashboard' || path.endsWith('/dashboard.html')) return 'dashboard';
    return null;
  },

  async fetchConfig() {
    const response = await fetch('/api/config');
    const payloadText = await response.text();
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let payload = null;

    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (error) {
        if (contentType.includes('application/json')) {
          const parseError = new Error('The app configuration response was not valid JSON.');
          parseError.code = 'CONFIG_INVALID';
          throw parseError;
        }
      }
    }

    if (!response.ok) {
      const configError = new Error(payload?.error || 'Unable to load app configuration');
      configError.code = 'CONFIG_UNAVAILABLE';
      throw configError;
    }

    if (!payload || typeof payload !== 'object') {
      const configError = new Error('The app configuration response was not valid JSON.');
      configError.code = 'CONFIG_INVALID';
      throw configError;
    }

    return payload;
  },

  async hydrateSession() {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      throw error;
    }

    this.state.session = data.session;

    if (!data.session) {
      return;
    }

    const { data: userData, error: userError } = await this.supabase.auth.getUser();
    if (userError || !userData?.user) {
      await this.supabase.auth.signOut({ scope: 'local' });
      this.state.session = null;
      this.resetAuthFlowState();
    }
  },

  normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  },

  validateEmail(email) {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) {
      return false;
    }

    const allowedDomain = String(this.config.allowedEmailDomain || '').trim().toLowerCase();
    if (!allowedDomain) {
      return true;
    }

    return normalizedEmail.endsWith(`@${allowedDomain}`);
  },

  getEmailValidationMessage() {
    const allowedDomain = String(this.config.allowedEmailDomain || '').trim().toLowerCase();
    return allowedDomain ? `Please use your @${allowedDomain} email address` : 'Please enter a valid email address';
  },

  normalizeJoinCode(joinCode) {
    return String(joinCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  getJoinCodeValue() {
    return this.normalizeJoinCode(
      document.getElementById('join-code-step-input')?.value
      || document.getElementById('join-code-input')?.value
      || this.state.teamPreview?.joinCode
    );
  },

  syncJoinCodeInputs(value = '') {
    const normalizedValue = this.normalizeJoinCode(value);
    ['join-code-input', 'join-code-step-input'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) {
        input.value = normalizedValue;
      }
    });
  },

  showJoinCodeError(message = '') {
    this.showFieldError('join-code-error', message);
    this.showFieldError('join-code-step-error', message);
  },

  getSelectedStudyYear() {
    return String(document.getElementById('study-year-input')?.value || '').trim().toLowerCase();
  },

  formatDashboardRole(role, { primary = false, request = false } = {}) {
    if (request) {
      return role === 'parent' ? 'Parent request' : 'Child request';
    }

    if (primary && role === 'parent') {
      return 'Primary Parent';
    }

    return role === 'parent' ? 'Parent' : 'Child';
  },

  getCurrentLaunchState() {
    if (!this.state.launch) {
      this.state.launch = getLaunchState();
    }
    return this.state.launch;
  },

  setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value || '';
    }
  },

  showFieldError(id, message = '') {
    this.setText(id, message);
  },

  showPageMessage(id, message = '') {
    this.setText(id, message);
  },

  setRegisterIntro(heading, subheading) {
    if (this.state.page !== 'register') {
      return;
    }

    const headingElement = document.getElementById('register-heading');
    const subheadingElement = document.getElementById('register-subheading');

    if (headingElement) {
      headingElement.textContent = '';
      headingElement.hidden = true;
    }

    if (subheadingElement) {
      subheadingElement.textContent = '';
      subheadingElement.hidden = true;
    }
  },

  setRegisterEmailMode(mode = 'parent') {
    if (this.state.page !== 'register') {
      return;
    }

    const emailLabel = document.getElementById('email-label');
    const emailInput = document.getElementById('email-input');

    if (!emailLabel || !emailInput) {
      return;
    }

    emailLabel.textContent = mode === 'signin' ? 'Email' : 'Email';
    emailInput.placeholder = 's1234567@ed.ac.uk';
  },

  syncRegisterEmailInput({ lockToSession = false } = {}) {
    if (this.state.page !== 'register') {
      return;
    }

    const emailInput = document.getElementById('email-input');
    if (!emailInput) {
      return;
    }

    if (lockToSession && this.state.session?.user?.email) {
      emailInput.value = this.state.session.user.email;
      emailInput.disabled = true;
      return;
    }

    emailInput.disabled = false;
  },

  setRegisteredConfirmation(registration) {
    if (this.state.page !== 'register') {
      return;
    }

    this.state.registration = registration || null;
    if (!registration) {
      this.setText('registered-role', '');
      this.updateRegisterRoleSummary();
      return;
    }

    this.setRegisterIntro(REGISTRATION_CONFIRMATION_TITLE, REGISTRATION_CONFIRMATION_COPY);
    this.setText('registered-role', registration?.roleLabel ? `Registered as ${registration.roleLabel}.` : '');
    this.updateRegisterRoleSummary();
  },

  getFriendlyRoleLabel(role) {
    return role === 'parent' ? 'Parent' : role === 'child' ? 'Child' : '';
  },

  getJoinRegistrationRole() {
    return this.state.registrationStatus?.registration?.role || this.state.registration?.role || '';
  },

  normalizeFlowStep(stepName) {
    if (this.state.page === 'join' && ['join-team', 'join-pool', 'invite-parent'].includes(stepName)) {
      return 'join-final';
    }

    return stepName;
  },

  getFlowStepOrder() {
    if (this.state.page === 'join') {
      return this.getJoinRegistrationRole() === 'parent'
        ? ['email', 'otp', 'join-final']
        : ['email', 'otp', 'child-choice', 'child-route', 'join-final'];
    }

    if (this.state.page === 'register' && this.getCurrentLaunchState().isRegistrationOpen) {
      return ['role', 'email', 'otp', 'registered'];
    }

    return [];
  },

  syncFlowProgress(stepName) {
    const normalizedStep = this.normalizeFlowStep(stepName);
    const order = this.getFlowStepOrder();
    const currentIndex = order.indexOf(normalizedStep);

    document.querySelectorAll('[data-flow-step]').forEach((item) => {
      const itemIndex = order.indexOf(item.dataset.flowStep);
      const isCurrent = item.dataset.flowStep === normalizedStep;
      const isComplete = currentIndex !== -1 && itemIndex !== -1 && itemIndex < currentIndex;

      item.classList.toggle('is-current', isCurrent);
      item.classList.toggle('is-complete', isComplete);
      item.classList.toggle('is-upcoming', !isCurrent && !isComplete);

      if (isCurrent) {
        item.setAttribute('aria-current', 'step');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  },

  updateRegisterRoleSummary() {
    if (this.state.page !== 'register') {
      return;
    }

    const launch = this.getCurrentLaunchState();
    const role = ['parent', 'child'].includes(this.state.registerIntent)
      ? this.state.registerIntent
      : this.state.registration?.role || '';
    const roleLabel = this.getFriendlyRoleLabel(role);
    const summary = roleLabel ? `Joining as ${roleLabel}.` : 'Choose Parent or Child to begin.';

    let detail = 'Pick the role you want to use on your family team. You can choose how to join after verification.';
    if (role && !launch.isNormalParticipationOpen) {
      detail = `${roleLabel}s are saving their place right now. Family setup opens later in the launch flow.`;
    } else if (role === 'parent') {
      detail = 'After verification you can create a new family or request to join one that already exists.';
    } else if (role === 'child') {
      detail = 'After verification you will choose your track, then join by code, random family, or parent invite.';
    }

    this.setText('register-role-summary', summary);
    this.setText('register-side-copy', detail);
    document.querySelectorAll('[data-register-role-chip]').forEach((element) => {
      element.textContent = roleLabel ? `Joining as ${roleLabel}` : 'Choose a role';
      element.hidden = !roleLabel;
    });
  },

  updateJoinRoleSummary(role = this.getJoinRegistrationRole()) {
    if (this.state.page !== 'join') {
      return;
    }

    const roleLabel = this.getFriendlyRoleLabel(role);
    const summary = roleLabel
      ? `Joining as ${roleLabel}.`
      : 'We will use your registered FamHack role after you sign in.';
    const detail = role === 'parent'
      ? 'Parents can request to join an existing family with a family code.'
      : role === 'child'
        ? 'Children choose a track first, then join by code, random family, or parent invite.'
        : 'Start by verifying your university email. The next steps adapt to your registered role.';

    this.setText('join-role-summary', summary);
    this.setText('join-side-copy', detail);
    document.querySelectorAll('[data-join-role-chip]').forEach((element) => {
      element.textContent = roleLabel ? `Joining as ${roleLabel}` : 'Role set after sign-in';
      element.hidden = !roleLabel;
    });
  },

  resetAuthFlowState() {
    clearInterval(this.state.resendTimer);
    this.state.resendTimer = null;
    clearTimeout(this.state.ctfAdvanceTimer);
    this.state.ctfAdvanceTimer = null;
    this.state.pendingEmail = '';
    this.state.teamPreview = null;
    this.state.dashboard = null;
    this.state.registration = null;
    this.state.registrationStatus = null;
    this.state.childFocus = '';
    this.state.childJoinMode = '';
    this.state.parentTeamKind = 'family';
    this.state.ctf = null;
    this.state.ctfPendingAdvanceState = null;
    this.state.ctfRecentKeys = [];
    this.state.ctfKonamiBusy = false;
    this.state.ctfKonamiRetry = false;
    this.state.ctfKonamiSolved = false;
    this.state.registerIntent = 'role';
    this.state.familyInviteActive = false;
    this.state.inviteLetterOpen = false;
    this.clearOTPInputs();
  },

  getStoredParentInviteToken() {
    try {
      return window.localStorage.getItem('famhack-parent-invite-token') || '';
    } catch (error) {
      return '';
    }
  },

  storeParentInviteToken(token) {
    try {
      if (token) {
        window.localStorage.setItem('famhack-parent-invite-token', token);
      } else {
        window.localStorage.removeItem('famhack-parent-invite-token');
      }
    } catch (error) {
      // Ignore storage failures and continue without persisted invite state.
    }
  },

  clearStoredParentInviteToken() {
    this.state.parentInviteToken = '';
    this.storeParentInviteToken('');
  },

  captureParentInviteToken() {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get('parentInvite') || '').trim();
    if (token) {
      this.state.parentInviteToken = token;
      this.storeParentInviteToken(token);
      return;
    }

    this.state.parentInviteToken = this.getStoredParentInviteToken();
  },

  captureFamilyInviteFlag() {
    const params = new URLSearchParams(window.location.search);
    this.state.familyInviteActive = params.get('familyInvite') === '1';
  },

  getJoinModeParam() {
    const params = new URLSearchParams(window.location.search);
    const mode = String(params.get('mode') || '').trim().toLowerCase();
    return ['code', 'pool', 'invite'].includes(mode) ? mode : '';
  },

  getActiveChildRoute(status = this.state.registrationStatus) {
    const poolEntry = status?.childPoolEntry || null;
    const parentInvite = status?.parentInvite || null;

    if (poolEntry && parentInvite) {
      const poolCreatedAt = Date.parse(poolEntry.createdAt || '') || 0;
      const inviteCreatedAt = Date.parse(parentInvite.createdAt || '') || 0;
      return inviteCreatedAt > poolCreatedAt ? 'invite' : 'pool';
    }

    if (poolEntry) {
      return 'pool';
    }

    if (parentInvite) {
      return 'invite';
    }

    return '';
  },

  setChildFocus(focus) {
    this.state.childFocus = String(focus || '').trim().toLowerCase();

    document.querySelectorAll('[data-child-focus-card]').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.childFocusCard === this.state.childFocus);
    });

    this.updateChildFocusSummary();
  },

  setChildJoinMode(mode) {
    const normalizedMode = ['code', 'pool', 'invite'].includes(String(mode || '').trim().toLowerCase())
      ? String(mode || '').trim().toLowerCase()
      : '';

    this.state.childJoinMode = normalizedMode;

    document.querySelectorAll('[data-child-join-mode-card]').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.childJoinModeCard === normalizedMode);
    });
  },

  getSelectedChildJoinMode() {
    return String(this.state.childJoinMode || '').trim().toLowerCase();
  },

  getSelectedChildFocus() {
    return String(this.state.childFocus || '').trim().toLowerCase();
  },

  getChildFocusLabel(focus = this.getSelectedChildFocus()) {
    return focus === 'hunter' ? 'Hunter' : focus === 'hacker' ? 'Hacker' : '';
  },

  getChildFocusDescription(focus = this.getSelectedChildFocus()) {
    return focus === 'hunter'
      ? 'Focused on the scavenger hunt'
      : focus === 'hacker'
        ? 'Focused on building the best products'
        : '';
  },

  setParentTeamKind(teamKind) {
    this.state.parentTeamKind = teamKind === 'volunteer' ? 'volunteer' : 'family';

    document.querySelectorAll('[data-parent-team-kind-card]').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.parentTeamKindCard === this.state.parentTeamKind);
    });

    const title = document.getElementById('parent-team-mode-title');
    const helper = document.getElementById('parent-team-mode-helper');
    const teamNameLabel = document.getElementById('team-name-label');
    const teamNameInput = document.getElementById('team-name-input');
    const createButton = document.getElementById('create-team-btn');

    if (title) {
      title.textContent = this.state.parentTeamKind === 'volunteer' ? 'Volunteer Parent Team' : 'Your Family';
    }

    if (helper) {
      helper.textContent = this.state.parentTeamKind === 'volunteer'
        ? 'Volunteer families are saved for later FamHack assignment.'
        : 'Once your family is created, the family code, letter link, and requests will appear here.';
    }

    if (teamNameLabel) {
      teamNameLabel.textContent = this.state.parentTeamKind === 'volunteer' ? 'Volunteer Team Name' : 'Family / Team Name';
    }

    if (teamNameInput) {
      teamNameInput.placeholder = this.state.parentTeamKind === 'volunteer' ? 'Volunteer House Toretto' : 'House Lovelace';
    }

    if (createButton) {
      this.setButtonLabel(createButton, this.state.parentTeamKind === 'volunteer' ? 'Become a Volunteer Parent' : 'Create a Family');
    }
  },

  getParentTeamKind() {
    return this.state.parentTeamKind === 'volunteer' ? 'volunteer' : 'family';
  },

  updateChildFocusSummary() {
    const label = this.getChildFocusLabel();
    const description = this.getChildFocusDescription();
    document.querySelectorAll('[data-child-focus-summary]').forEach((element) => {
      element.textContent = label ? `${label} · ${description}` : 'Choose Hunter or Hacker first.';
    });
  },

  syncJoinInterfaceForRole(role = this.getJoinRegistrationRole()) {
    if (this.state.page !== 'join') {
      return;
    }

    const isChild = role === 'child';
    const childChoiceStep = document.querySelector('[data-step="child-choice"]');
    const childRouteStep = document.querySelector('[data-step="child-route"]');
    const joinTeamFocusCard = document.getElementById('join-team-focus-card');
    const joinTeamTitle = document.getElementById('join-team-title');
    const joinTeamCopy = document.getElementById('join-team-copy');
    const joinRequestHelper = document.getElementById('join-request-helper');
    const pageHeading = document.getElementById('join-heading');
    const pageSubheading = document.getElementById('join-subheading');

    if (childChoiceStep) {
      childChoiceStep.hidden = !isChild;
    }

    if (childRouteStep) {
      childRouteStep.hidden = !isChild;
    }

    if (joinTeamFocusCard) {
      joinTeamFocusCard.hidden = !isChild;
    }

    if (joinTeamTitle) {
      joinTeamTitle.textContent = isChild ? 'Send your join request' : 'Request to join this family';
    }

    if (joinTeamCopy) {
      joinTeamCopy.textContent = isChild
        ? 'A parent in the family will review this request.'
        : 'The current primary parent will review this request.';
    }

    if (joinRequestHelper) {
      joinRequestHelper.textContent = isChild
        ? 'Your request keeps the Child role you registered with.'
        : 'Your request keeps the Parent role you registered with.';
    }

    if (pageHeading) {
      pageHeading.textContent = isChild ? 'Join FamHack' : 'Join an Existing Family';
    }

    if (pageSubheading) {
      pageSubheading.textContent = isChild
        ? 'Verify your email, choose your track, then follow one clear path into a family.'
        : 'Verify your email, enter a family code, and request to join the family.';
    }

    this.updateJoinRoleSummary(role);
  },

  ensureChildFocus(errorId = 'join-choice-error') {
    const focus = this.getSelectedChildFocus();
    if (focus === 'hunter' || focus === 'hacker') {
      return focus;
    }

    this.showFieldError(errorId, 'Choose Hunter or Hacker before continuing');
    return '';
  },

  prefillChildProfileFields(profile = {}) {
    const fullName = String(profile?.fullName || '').trim();
    const studyYear = String(profile?.studyYear || '').trim().toLowerCase();

    ['full-name-input', 'pool-full-name-input', 'invite-child-name-input'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && !input.value && fullName) {
        input.value = fullName;
      }
    });

    ['study-year-input', 'pool-study-year-input', 'invite-study-year-input'].forEach((id) => {
      const select = document.getElementById(id);
      if (select && !select.value && studyYear) {
        select.value = studyYear;
      }
    });
  },

  prefillParentInviteEmail(parentInvite = {}) {
    const input = document.getElementById('parent-email-input');
    const parentEmail = this.normalizeEmail(parentInvite?.parentEmail);

    if (input && !input.value && parentEmail) {
      input.value = parentEmail;
    }
  },

  openInviteLetter({ kicker = 'Invitation', title = '', paragraphs = [], confirmLabel = 'Continue' } = {}) {
    const modal = document.getElementById('invite-letter-modal');
    const kickerEl = document.getElementById('invite-letter-kicker');
    const titleEl = document.getElementById('invite-letter-title');
    const bodyEl = document.getElementById('invite-letter-body');
    const confirmButton = document.getElementById('invite-letter-confirm');

    if (!modal || this.state.inviteLetterOpen) {
      return;
    }

    this.state.inviteLetterOpen = true;

    if (kickerEl) {
      kickerEl.textContent = kicker;
    }

    if (titleEl) {
      titleEl.textContent = title;
    }

    if (bodyEl) {
      bodyEl.innerHTML = paragraphs
        .filter(Boolean)
        .map((paragraph) => `<p class="invite-letter-copy">${this.escapeHtml(paragraph)}</p>`)
        .join('');
    }

    if (confirmButton) {
      confirmButton.textContent = confirmLabel;
    }

    modal.hidden = false;
    modal.style.opacity = '1';
    document.body.classList.add('invite-letter-modal-open');

    const card = modal.querySelector('.invite-letter-card');
    if (typeof window.gsap !== 'undefined' && card) {
      window.gsap.fromTo(
        card,
        { opacity: 0, y: 22, scale: 0.986 },
        { opacity: 1, y: 0, scale: 1, duration: 0.34, ease: 'power2.out' },
      );
    }
  },

  closeInviteLetter(options = {}) {
    const modal = document.getElementById('invite-letter-modal');
    const card = modal?.querySelector('.invite-letter-card');

    if (!modal || (!this.state.inviteLetterOpen && modal.hidden)) {
      return;
    }

    this.state.inviteLetterOpen = false;
    document.body.classList.remove('invite-letter-modal-open');

    const finish = () => {
      modal.hidden = true;
      modal.style.opacity = '';
    };

    if (options.silent || typeof window.gsap === 'undefined' || !card) {
      finish();
      return;
    }

    window.gsap.to(card, {
      opacity: 0,
      y: -10,
      scale: 0.986,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: finish,
    });
    window.gsap.to(modal, {
      opacity: 0,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: () => {
        modal.style.opacity = '';
      },
    });
  },

  bindInviteLetterModal() {
    const modal = document.getElementById('invite-letter-modal');
    if (!modal || modal.dataset.bound === 'true') {
      return;
    }

    modal.dataset.bound = 'true';
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-invite-letter-close]')) {
        this.closeInviteLetter();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.state.inviteLetterOpen) {
        this.closeInviteLetter();
      }
    });
  },

  async maybeShowRegisterInviteLetter() {
    if (this.state.page !== 'register' || !this.state.parentInviteToken) {
      return;
    }

    try {
      const response = await fetch(`/api/invite/preview?parentInvite=${encodeURIComponent(this.state.parentInviteToken)}`);
      const payload = await response.json();
      const invite = payload?.invite || null;
      const childName = invite?.childName || 'Your child';
      const focusLabel = invite?.childFocusLabel || 'their track';

      this.openInviteLetter({
        kicker: 'From Your Child',
        title: `${childName} wants the whole family at FamHack.`,
        paragraphs: [
          `${childName} wants to attend FamHack and needs you to register the family so it can happen.`,
          `There will be free pizza, snacks, games, a scavenger hunt, coding, and prizes for the whole family.`,
          `Register on 28 March, pick your family mode, and FamHack will attach ${childName} automatically. ${focusLabel ? `${childName} is aiming for ${focusLabel}.` : ''}`.trim(),
        ],
        confirmLabel: 'Register The Family',
      });
    } catch (error) {
      this.openInviteLetter({
        kicker: 'From Your Child',
        title: 'Your child wants the whole family at FamHack.',
        paragraphs: [
          'They need you to register so the family can take part together.',
          'There will be free pizza, snacks, games, a scavenger hunt, coding, and prizes for the whole family.',
        ],
        confirmLabel: 'Register The Family',
      });
    }
  },

  maybeShowJoinInviteLetter() {
    if (this.state.page !== 'join' || !this.state.familyInviteActive) {
      return;
    }

    const familyName = this.state.teamPreview?.name || 'your family';
    this.openInviteLetter({
      kicker: 'From Your Parent',
      title: 'Your parent invited you to FamHack.',
      paragraphs: [
        `Your parent has invited you to take part in FamHack with them through ${familyName}.`,
        'Sign in, pick your track, and join the family.',
      ],
      confirmLabel: 'Join The Family',
    });
  },

  getFriendlyOtpErrorMessage(error) {
    const message = String(error?.message || '').toLowerCase();

    if (
      message.includes('token has expired or is invalid')
      || message.includes('email link is invalid or has expired')
      || message.includes('invalid token')
      || message.includes('otp')
    ) {
      return `That ${this.config.otpLength}-digit code is incorrect, expired, or from an older email. Use the latest code or request a new one.`;
    }

    return error?.message || 'Unable to verify that code';
  },

  showStep(stepName) {
    const steps = document.querySelectorAll('.register-step');
    this.syncFlowProgress(stepName);
    steps.forEach((step) => {
      step.classList.toggle('active', step.dataset.step === stepName);

      if (step.dataset.step === stepName && typeof window.gsap !== 'undefined') {
        window.gsap.fromTo(
          step,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
        );
      }
    });
  },

  getButtonLabel(button) {
    return button?.querySelector('.button-label') || button;
  },

  setButtonState(button, { busy, label, idleLabel }) {
    if (!button) return;

    button.disabled = Boolean(busy);
    button.classList.toggle('btn-loading', Boolean(busy));

    const labelNode = this.getButtonLabel(button);
    if (labelNode && label) {
      labelNode.textContent = busy ? label : idleLabel || labelNode.dataset.idleLabel || labelNode.textContent;
      if (!labelNode.dataset.idleLabel) {
        labelNode.dataset.idleLabel = idleLabel || labelNode.textContent;
      }
    }
  },

  setButtonLabel(button, label) {
    const labelNode = this.getButtonLabel(button);
    if (!labelNode) return;
    labelNode.textContent = label;
    labelNode.dataset.idleLabel = label;
  },

  initOTPInputs() {
    const otpInputs = document.querySelectorAll('.otp-digit');
    if (!otpInputs.length) {
      return;
    }

    otpInputs.forEach((input, index) => {
      input.addEventListener('input', (event) => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, 1);
        if (event.target.value && index < otpInputs.length - 1) {
          otpInputs[index + 1].focus();
        }
        this.checkOTPComplete();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !event.target.value && index > 0) {
          otpInputs[index - 1].focus();
          return;
        }

        if (event.key === 'Enter') {
          const verifyButton = document.getElementById('verify-otp-btn');
          if (this.getOTPValue().length === this.config.otpLength && verifyButton && !verifyButton.disabled) {
            event.preventDefault();
            this.handleVerifyOTP();
          }
        }
      });

      input.addEventListener('paste', (event) => {
        event.preventDefault();
        const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, this.config.otpLength);
        digits.split('').forEach((digit, digitIndex) => {
          if (otpInputs[digitIndex]) {
            otpInputs[digitIndex].value = digit;
          }
        });
        this.checkOTPComplete();
      });
    });
  },

  checkOTPComplete() {
    const verifyButton = document.getElementById('verify-otp-btn');
    if (!verifyButton) return;
    verifyButton.disabled = this.getOTPValue().length !== this.config.otpLength;
  },

  getOTPValue() {
    return Array.from(document.querySelectorAll('.otp-digit')).map((input) => input.value).join('');
  },

  clearOTPInputs() {
    document.querySelectorAll('.otp-digit').forEach((input) => {
      input.value = '';
    });
    this.checkOTPComplete();
  },

  initHomePageBase() {
    this.initHomeLogoMotion();
    this.initHomeHashNavigation();
    this.initHomeFaq();
    this.initHomeProgrammeRail();
    this.initHomeScheduleClock();
    this.initHomeSignalAnomaly();
    this.initHomeZoneMotion();

    const participateLink = document.getElementById('participate-link');
    if (participateLink) {
      participateLink.href = '/register';
    }
  },

  async initHomePage() {

    const participateLink = document.getElementById('participate-link');
    if (!participateLink) {
      return;
    }

    participateLink.href = '/register';
    participateLink.addEventListener('click', async (event) => {
      event.preventDefault();

      const button = participateLink.querySelector('.button');
      const labelNode = participateLink.querySelector('.button-label');
      const originalLabel = labelNode?.textContent || 'Participate';

      participateLink.style.pointerEvents = 'none';
      button?.classList.add('btn-loading');
      if (labelNode) {
        labelNode.textContent = 'Opening...';
      }

      try {
        const { destination } = await this.resolveParticipateState();
        participateLink.href = destination;
        this.redirect(destination);
      } finally {
        participateLink.style.pointerEvents = '';
        button?.classList.remove('btn-loading');
        if (labelNode) {
          labelNode.textContent = this.state.participateLabel || originalLabel;
        }
      }
    });

    const { destination, label } = await this.resolveParticipateState();
    participateLink.href = destination;
    const labelNode = participateLink.querySelector('.button-label');
    if (labelNode) {
      labelNode.textContent = label;
    }
  },

  initHomeHashNavigation() {
    const hashLinks = document.querySelectorAll('a[href^="#"]');
    if (!hashLinks.length) {
      return;
    }

    hashLinks.forEach((link) => {
      link.addEventListener('click', (event) => {
        const hash = link.getAttribute('href');
        if (!hash || hash === '#') {
          return;
        }

        const target = hash === '#top' ? document.documentElement : document.querySelector(hash);
        if (!target) {
          return;
        }

        event.preventDefault();

        const delay = document.body.classList.contains('menu-open') ? 360 : 0;
        window.setTimeout(() => {
          this.scrollHomeToHash(hash);
        }, delay);
      });
    });

    if (window.location.hash) {
      window.requestAnimationFrame(() => {
        this.scrollHomeToHash(window.location.hash, {
          behavior: 'auto',
          updateHistory: false,
        });
      });
    }
  },

  scrollHomeToHash(hash, options = {}) {
    const target = hash === '#top' ? document.documentElement : document.querySelector(hash);
    if (!target) {
      return;
    }

    if (hash !== '#top' && target.id) {
      this.setHomeProgrammeActive(target.id);
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smooth = options.behavior === 'auto' || prefersReducedMotion ? false : true;
    const smoother = window.ScrollSmoother?.get?.();

    if (smoother) {
      if (hash === '#top') {
        smoother.scrollTo(0, smooth);
      } else {
        smoother.scrollTo(target, smooth, 'top top');
      }
    } else {
      const top = hash === '#top'
        ? 0
        : Math.max(target.getBoundingClientRect().top + window.pageYOffset, 0);

      window.scrollTo({
        top,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }

    if (options.updateHistory === false) {
      return;
    }

    if (window.history?.pushState) {
      window.history.pushState(null, '', hash);
    } else {
      window.location.hash = hash;
    }
  },

  initHomeFaq() {
    const faqItems = Array.from(document.querySelectorAll('.faq-item'));
    if (!faqItems.length) {
      return;
    }

    const faqList = document.querySelector('.faq-list');
    const hoverToggle = document.querySelector('[data-faq-hover-toggle]');

    this.state.homeFaq = {
      items: faqItems,
      list: faqList,
      hoverToggle,
      hoverMode: false,
      hoveredItem: null,
      toggleAnimationTimeout: null,
    };

    faqItems.forEach((item) => {
      const summary = item.querySelector('.faq-question');
      const answer = item.querySelector('.faq-answer');
      if (!summary || !answer) {
        return;
      }

      const answerInner = this.ensureFaqAnswerInner(answer);
      answer.style.overflow = 'hidden';
      answer.style.contain = 'layout paint';
      const isOpen = item.classList.contains('is-open');
      answer.style.height = isOpen ? 'auto' : '0px';
      answerInner.style.opacity = isOpen ? '1' : '0';
      answerInner.style.visibility = isOpen ? 'visible' : 'hidden';
      summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      item.dataset.targetOpen = isOpen ? 'true' : 'false';

      summary.addEventListener('click', (event) => {
        event.preventDefault();
        this.setFaqItemTarget(item, item.dataset.targetOpen !== 'true');
      });

    });

    if (faqList) {
      faqList.addEventListener('pointermove', (event) => {
        if (!this.state.homeFaq?.hoverMode) {
          return;
        }

        const hoveredItem = event.target instanceof Element
          ? event.target.closest('.faq-item')
          : null;

        this.setHomeFaqHoveredItem(hoveredItem instanceof HTMLElement ? hoveredItem : null);
      });

      faqList.addEventListener('mouseleave', () => {
        if (!this.state.homeFaq?.hoverMode) {
          return;
        }

        this.setHomeFaqHoveredItem(null);
      });
    }

    window.addEventListener('scroll', () => {
      if (!this.state.homeFaq?.hoverMode) {
        return;
      }

      const hoveredItem = document.querySelector('.faq-list .faq-item:hover');
      if (!hoveredItem) {
        this.setHomeFaqHoveredItem(null);
      }
    }, { passive: true });

    if (hoverToggle) {
      hoverToggle.addEventListener('click', (event) => {
        event.preventDefault();
        this.setHomeFaqHoverMode(!this.state.homeFaq?.hoverMode);
      });
    }

    this.syncHomeFaqHoverUi();
  },

  syncHomeFaqHoverUi() {
    const homeFaq = this.state.homeFaq;
    if (!homeFaq) {
      return;
    }

    const { hoverToggle, list } = homeFaq;

    if (hoverToggle) {
      hoverToggle.classList.toggle('is-active', homeFaq.hoverMode);
      hoverToggle.setAttribute('aria-pressed', homeFaq.hoverMode ? 'true' : 'false');
      hoverToggle.setAttribute('aria-label', homeFaq.hoverMode ? 'Disable auto expand' : 'Enable auto expand');
    }

    if (list) {
      list.classList.toggle('is-hover-mode', homeFaq.hoverMode);
    }
  },

  setHomeFaqHoverMode(enabled) {
    const homeFaq = this.state.homeFaq;
    if (!homeFaq) {
      return;
    }

    const nextState = Boolean(enabled);
    homeFaq.hoverMode = nextState;
    this.syncHomeFaqHoverUi();
    this.animateHomeFaqHoverToggle(nextState);

    if (nextState) {
      const hoveredItem = document.querySelector('.faq-item:hover');
      this.setHomeFaqHoveredItem(hoveredItem instanceof HTMLElement ? hoveredItem : null);
      return;
    }

    homeFaq.hoveredItem = null;
    this.closeAllHomeFaqItems();
  },

  ensureFaqAnswerInner(answer) {
    const existingInner = answer.querySelector(':scope > .faq-answer-inner');
    if (existingInner) {
      return existingInner;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'faq-answer-inner';

    while (answer.firstChild) {
      wrapper.append(answer.firstChild);
    }

    answer.append(wrapper);
    return wrapper;
  },

  setHomeFaqHoveredItem(item) {
    const homeFaq = this.state.homeFaq;
    if (!homeFaq) {
      return;
    }

    if (homeFaq.hoveredItem === item) {
      return;
    }

    homeFaq.hoveredItem = item;
    homeFaq.items.forEach((faqItem) => {
      this.setFaqItemTarget(faqItem, faqItem === item);
    });
  },

  closeAllHomeFaqItems() {
    const homeFaq = this.state.homeFaq;
    if (!homeFaq) {
      return;
    }

    homeFaq.items.forEach((item) => {
      this.setFaqItemTarget(item, false);
    });
  },

  animateHomeFaqHoverToggle(enabled) {
    const homeFaq = this.state.homeFaq;
    const hoverToggle = homeFaq?.hoverToggle;
    if (!hoverToggle) {
      return;
    }

    const nextClass = enabled ? 'is-switching-on' : 'is-switching-off';
    hoverToggle.classList.remove('is-switching-on', 'is-switching-off');
    void hoverToggle.offsetWidth;
    hoverToggle.classList.add(nextClass);

    if (homeFaq.toggleAnimationTimeout) {
      window.clearTimeout(homeFaq.toggleAnimationTimeout);
    }

    homeFaq.toggleAnimationTimeout = window.setTimeout(() => {
      hoverToggle.classList.remove('is-switching-on', 'is-switching-off');
      homeFaq.toggleAnimationTimeout = null;
    }, 620);
  },

  setFaqItemTarget(item, shouldOpen) {
    const answer = item.querySelector('.faq-answer');
    if (!answer) {
      return;
    }

    item.dataset.targetOpen = shouldOpen ? 'true' : 'false';
    this.syncFaqItemState(item, answer);
  },

  syncFaqItemState(item, answer) {
    if (item.dataset.animating === 'true') {
      return;
    }

    const targetOpen = item.dataset.targetOpen === 'true';

    if (targetOpen === item.classList.contains('is-open')) {
      return;
    }

    if (targetOpen) {
      this.openFaqItem(item, answer);
      return;
    }

    this.closeFaqItem(item, answer);
  },

  setHomeProgrammeActive(zoneId) {
    const links = document.querySelectorAll('[data-programme-link]');
    if (!links.length) {
      return;
    }

    links.forEach((link) => {
      const isActive = link.dataset.programmeLink === zoneId;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  },

  syncHomeProgrammePinOffset() {
    const rail = document.querySelector('.home-programme-rail');
    const railFrame = document.querySelector('.home-programme-rail-frame');
    if (!rail || !railFrame) {
      return {
        endOffset: 48,
        startOffset: 48,
      };
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const minGap = 32;
    const fallbackGap = 48;

    if (!viewportHeight) {
      rail.style.setProperty('--home-programme-pin-top', `${fallbackGap}px`);
      rail.style.setProperty('--home-programme-max-height', `calc(100vh - ${fallbackGap * 2}px)`);
      return {
        endOffset: fallbackGap,
        startOffset: fallbackGap,
      };
    }

    const naturalHeight = railFrame.scrollHeight || railFrame.offsetHeight || rail.offsetHeight || 0;
    const maxVisibleHeight = Math.max(220, viewportHeight - minGap * 2);
    const visibleHeight = Math.min(naturalHeight, maxVisibleHeight);
    const centeredOffset = Math.round((viewportHeight - visibleHeight) / 2);
    const pinOffset = Math.max(minGap, centeredOffset);
    const endOffset = Math.max(minGap, viewportHeight - pinOffset - visibleHeight);

    rail.style.setProperty('--home-programme-pin-top', `${pinOffset}px`);
    rail.style.setProperty('--home-programme-max-height', `${visibleHeight}px`);

    return {
      endOffset,
      startOffset: pinOffset,
    };
  },

  initHomeProgrammeRail() {
    const zones = Array.from(document.querySelectorAll('[data-home-zone]')).filter((zone) => zone.id);
    const railLinks = document.querySelectorAll('[data-programme-link]');
    if (!zones.length || !railLinks.length) {
      return;
    }

    const hashId = window.location.hash ? window.location.hash.slice(1) : '';
    const initialZoneId = zones.some((zone) => zone.id === hashId) ? hashId : zones[0].id;
    this.setHomeProgrammeActive(initialZoneId);

    const scrollTrigger = window.ScrollTrigger;
    if (scrollTrigger?.create) {
      const rail = document.querySelector('.home-programme-rail');
      const controlMain = document.querySelector('.home-control-main');

      if (rail && controlMain && window.matchMedia('(min-width: 992px)').matches) {
        rail.classList.remove('is-sticky-fallback');

        scrollTrigger.create({
          trigger: rail,
          start: () => {
            const { startOffset } = this.syncHomeProgrammePinOffset();
            return `top top+=${startOffset}`;
          },
          endTrigger: controlMain,
          end: () => {
            const { endOffset } = this.syncHomeProgrammePinOffset();
            return `bottom bottom-=${endOffset}`;
          },
          pin: rail,
          pinSpacing: false,
          invalidateOnRefresh: true,
          onRefreshInit: () => this.syncHomeProgrammePinOffset(),
          onRefresh: () => this.syncHomeProgrammePinOffset(),
        });
      }

      zones.forEach((zone) => {
        scrollTrigger.create({
          trigger: zone,
          start: 'top center',
          end: 'bottom center',
          onEnter: () => this.setHomeProgrammeActive(zone.id),
          onEnterBack: () => this.setHomeProgrammeActive(zone.id),
        });
      });

      scrollTrigger.refresh();
      return;
    }

    const rail = document.querySelector('.home-programme-rail');
    if (rail && window.matchMedia('(min-width: 992px)').matches) {
      this.syncHomeProgrammePinOffset();
      rail.classList.add('is-sticky-fallback');
    }

    const updateActiveZone = () => {
      let activeZone = zones[0];
      zones.forEach((zone) => {
        const rect = zone.getBoundingClientRect();
        if (rect.top <= window.innerHeight * 0.42) {
          activeZone = zone;
        }
      });

      if (activeZone?.id) {
        this.setHomeProgrammeActive(activeZone.id);
      }
    };

    updateActiveZone();
    window.addEventListener('scroll', updateActiveZone, { passive: true });
  },

  initHomeSignalAnomaly() {
    const toggle = document.querySelector('[data-signal-toggle]');
    const panel = document.querySelector('[data-signal-panel]');
    if (!toggle || !panel) {
      return;
    }

    panel.style.overflow = 'hidden';
    panel.style.height = '0px';

    toggle.addEventListener('click', () => {
      if (toggle.dataset.animating === 'true') {
        return;
      }

      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        this.closeHomeSignalPanel(toggle, panel);
      } else {
        this.openHomeSignalPanel(toggle, panel);
      }
    });
  },

  initHomeScheduleClock() {
    const hourHand = document.querySelector('.home-schedule-clock-hand-hour');
    const minuteHand = document.querySelector('.home-schedule-clock-hand-minute');
    const secondHand = document.querySelector('.home-schedule-clock-hand-second');
    if (!hourHand || !minuteHand || !secondHand) {
      return;
    }

    window.cancelAnimationFrame(this.state.homeClockFrame);
    window.clearTimeout(this.state.homeClockTimer);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderClock = () => {
      const now = new Date();
      const milliseconds = now.getMilliseconds();
      const seconds = now.getSeconds() + (prefersReducedMotion ? 0 : milliseconds / 1000);
      const minutes = now.getMinutes() + seconds / 60;
      const hours = (now.getHours() % 12) + minutes / 60;

      hourHand.style.setProperty('--home-clock-rotation', `${hours * 30}deg`);
      minuteHand.style.setProperty('--home-clock-rotation', `${minutes * 6}deg`);
      secondHand.style.setProperty('--home-clock-rotation', `${seconds * 6}deg`);
    };

    const tick = () => {
      renderClock();

      if (prefersReducedMotion) {
        const millisecondsUntilNextSecond = 1000 - new Date().getMilliseconds();
        this.state.homeClockTimer = window.setTimeout(tick, millisecondsUntilNextSecond);
        return;
      }

      this.state.homeClockFrame = window.requestAnimationFrame(tick);
    };

    tick();

    window.addEventListener('pagehide', () => {
      window.cancelAnimationFrame(this.state.homeClockFrame);
      window.clearTimeout(this.state.homeClockTimer);
      this.state.homeClockFrame = null;
      this.state.homeClockTimer = null;
    }, { once: true });
  },

  openHomeSignalPanel(toggle, panel) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stateLabel = toggle.querySelector('.home-signal-toggle-state');

    toggle.dataset.animating = 'true';
    toggle.setAttribute('aria-expanded', 'true');
    if (stateLabel) {
      stateLabel.textContent = 'Decoded';
    }

    panel.hidden = false;
    panel.classList.add('is-open');

    if (prefersReducedMotion) {
      panel.style.height = 'auto';
      delete toggle.dataset.animating;
      return;
    }

    panel.style.height = '0px';
    const endHeight = panel.scrollHeight;

    window.requestAnimationFrame(() => {
      panel.style.height = `${endHeight}px`;
    });

    const onTransitionEnd = (event) => {
      if (event.propertyName !== 'height') {
        return;
      }

      panel.style.height = 'auto';
      delete toggle.dataset.animating;
      panel.removeEventListener('transitionend', onTransitionEnd);
    };

    panel.addEventListener('transitionend', onTransitionEnd);
  },

  closeHomeSignalPanel(toggle, panel) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stateLabel = toggle.querySelector('.home-signal-toggle-state');

    toggle.dataset.animating = 'true';
    toggle.setAttribute('aria-expanded', 'false');
    if (stateLabel) {
      stateLabel.textContent = 'Decode';
    }

    if (prefersReducedMotion) {
      panel.classList.remove('is-open');
      panel.hidden = true;
      panel.style.height = '0px';
      delete toggle.dataset.animating;
      return;
    }

    panel.style.height = `${panel.scrollHeight}px`;

    window.requestAnimationFrame(() => {
      panel.classList.remove('is-open');
      panel.style.height = '0px';
    });

    const onTransitionEnd = (event) => {
      if (event.propertyName !== 'height') {
        return;
      }

      panel.hidden = true;
      delete toggle.dataset.animating;
      panel.removeEventListener('transitionend', onTransitionEnd);
    };

    panel.addEventListener('transitionend', onTransitionEnd);
  },

  initHomeZoneMotion() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gsapInstance = window.gsap;
    const scrollTrigger = window.ScrollTrigger;

    if (prefersReducedMotion || !gsapInstance || !scrollTrigger?.create) {
      return;
    }

    const rail = document.querySelector('.home-programme-rail-frame');
    if (rail) {
      gsapInstance.from(rail, {
        x: -28,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: rail,
          start: 'top 85%',
        },
      });
    }

    document.querySelectorAll('.home-zone-frame').forEach((frame) => {
      const targets = frame.querySelectorAll(
        '.home-zone-kicker, .home-zone-heading, .home-zone-stamp, .home-zone-text, .home-mission-tag, .home-mission-board, .home-protocol-item, .home-register-summary-item, .track-card, .track-route, .home-checkpoint, .faq-item'
      );

      if (!targets.length) {
        return;
      }

      gsapInstance.from(targets, {
        y: 32,
        opacity: 0,
        duration: 0.78,
        stagger: 0.06,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: frame,
          start: 'top 78%',
        },
        clearProps: 'all',
      });
    });

    scrollTrigger.refresh();
  },

  openFaqItem(item, answer) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gsapInstance = window.gsap;
    const answerInner = this.ensureFaqAnswerInner(answer);
    const trigger = item.querySelector('.faq-question');
    const startHeight = answer.getBoundingClientRect().height;

    item.dataset.animating = 'true';
    item.classList.add('is-open');
    trigger?.setAttribute('aria-expanded', 'true');
    answer.style.overflow = 'hidden';
    answer.style.willChange = 'height';
    answerInner.style.willChange = 'opacity';

    if (!gsapInstance || prefersReducedMotion) {
      answer.style.height = 'auto';
      answer.style.willChange = '';
      answerInner.style.opacity = '1';
      answerInner.style.visibility = 'visible';
      answerInner.style.willChange = '';
      delete item.dataset.animating;
      this.syncFaqItemState(item, answer);
      return;
    }

    gsapInstance.killTweensOf(answer);
    gsapInstance.killTweensOf(answerInner);
    answer.style.height = `${startHeight}px`;
    answerInner.style.visibility = 'hidden';
    answerInner.style.opacity = '0';

    const timeline = gsapInstance.timeline({
      defaults: {
        overwrite: true,
      },
      onComplete: () => {
        answer.style.height = 'auto';
        answer.style.willChange = '';
        answerInner.style.opacity = '1';
        answerInner.style.visibility = 'visible';
        answerInner.style.willChange = '';
        delete item.dataset.animating;
        this.syncFaqItemState(item, answer);
      },
    });

    timeline.set(answerInner, {
      visibility: 'visible',
      opacity: 1,
    });

    timeline.to(answer, {
      height: answer.scrollHeight,
      duration: 0.16,
      ease: 'power2.out',
    });
  },

  closeFaqItem(item, answer) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gsapInstance = window.gsap;
    const answerInner = this.ensureFaqAnswerInner(answer);
    const trigger = item.querySelector('.faq-question');
    const startHeight = answer.getBoundingClientRect().height || answer.scrollHeight;

    item.dataset.animating = 'true';
    trigger?.setAttribute('aria-expanded', 'false');
    answer.style.overflow = 'hidden';
    answer.style.height = `${startHeight}px`;
    answer.style.willChange = 'height';
    answerInner.style.willChange = 'opacity';

    if (!gsapInstance || prefersReducedMotion) {
      answer.style.height = '0px';
      answer.style.willChange = '';
      answerInner.style.opacity = '0';
      answerInner.style.visibility = 'hidden';
      answerInner.style.willChange = '';
      item.classList.remove('is-open');
      delete item.dataset.animating;
      this.syncFaqItemState(item, answer);
      return;
    }

    gsapInstance.killTweensOf(answer);
    gsapInstance.killTweensOf(answerInner);

    const timeline = gsapInstance.timeline({
      defaults: {
        overwrite: true,
      },
      onComplete: () => {
        answer.style.height = '0px';
        answer.style.willChange = '';
        answerInner.style.opacity = '0';
        answerInner.style.visibility = 'hidden';
        answerInner.style.willChange = '';
        item.classList.remove('is-open');
        delete item.dataset.animating;
        this.syncFaqItemState(item, answer);
      },
    });

    timeline.to(answerInner, {
      opacity: 0,
      duration: 0.04,
      ease: 'none',
    });

    timeline.set(answerInner, {
      visibility: 'hidden',
    });

    timeline.to(answer, {
      height: 0,
      duration: 0.14,
      ease: 'power2.inOut',
    });
  },

  initHomeLogoMotion() {
    const logo = document.querySelector('.famhack-hero-logo');
    if (!logo) {
      return;
    }

    this.state.logoJitterElement = logo;
    const resetLogo = () => {
      clearTimeout(this.state.logoResetTimer);
      this.state.logoResetTimer = null;
      this.state.logoLastPointerX = null;
      this.state.logoLastPointerY = null;
      logo.style.transform = '';
    };

    logo.addEventListener('pointerenter', (event) => {
      this.state.logoLastPointerX = event.clientX;
      this.state.logoLastPointerY = event.clientY;
    });

    logo.addEventListener('pointermove', (event) => {
      const rect = logo.getBoundingClientRect();
      const offsetX = ((event.clientX - rect.left) / rect.width) - 0.5;
      const offsetY = ((event.clientY - rect.top) / rect.height) - 0.5;
      const deltaX = this.state.logoLastPointerX == null ? 0 : event.clientX - this.state.logoLastPointerX;
      const deltaY = this.state.logoLastPointerY == null ? 0 : event.clientY - this.state.logoLastPointerY;
      const velocity = Math.min(Math.hypot(deltaX, deltaY), 16);

      this.state.logoLastPointerX = event.clientX;
      this.state.logoLastPointerY = event.clientY;

      const translateX = (offsetX * 2.2) + (deltaX * 0.24);
      const translateY = (offsetY * 0.9) + (deltaY * 0.08);
      const rotate = (offsetX * 0.38) + (deltaX * 0.03);
      const scale = 1 + (velocity * 0.00045);

      logo.style.transform = `translate3d(${translateX.toFixed(3)}px, ${translateY.toFixed(3)}px, 0) rotate(${rotate.toFixed(3)}deg) scale(${scale.toFixed(4)})`;

      clearTimeout(this.state.logoResetTimer);
      this.state.logoResetTimer = window.setTimeout(() => {
        logo.style.transform = '';
      }, 90);
    });

    logo.addEventListener('pointerleave', resetLogo);

    window.addEventListener('pagehide', () => {
      resetLogo();
    }, { once: true });
  },

  async resolveParticipateDestination() {
    const { destination } = await this.resolveParticipateState();
    return destination;
  },

  async resolveParticipateState() {
    if (this.state.participateDestination && this.state.participateLabel) {
      return {
        destination: this.state.participateDestination,
        label: this.state.participateLabel,
      };
    }

    if (this.state.participateCheckPromise) {
      return this.state.participateCheckPromise;
    }

    this.state.participateCheckPromise = (async () => {
      const launch = this.getCurrentLaunchState();

      if (!this.state.session) {
        return {
          destination: '/register',
          label: launch.isRegistrationOpen ? 'Participate' : 'Sign In',
        };
      }

      if (launch.isRegistrationOpen) {
        return {
          destination: '/register',
          label: 'Participate',
        };
      }

      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (!dashboard) {
        return {
          destination: '/register',
          label: 'Sign In',
        };
      }

      return {
        destination: '/dashboard',
        label: dashboard.viewer?.role === 'parent' ? 'Manage My Family' : 'View My Family',
      };
    })();

    try {
      const resolvedState = await this.state.participateCheckPromise;
      this.state.participateDestination = resolvedState.destination;
      this.state.participateLabel = resolvedState.label;
      return resolvedState;
    } finally {
      this.state.participateCheckPromise = null;
    }
  },

  async initRegisterPage() {
    this.bindInviteLetterModal();
    document.getElementById('choose-parent-btn')?.addEventListener('click', () => this.handleChooseParent());
    document.getElementById('choose-child-btn')?.addEventListener('click', () => this.handleChooseChildRole());
    document.getElementById('choose-student-btn')?.addEventListener('click', () => this.handleChooseChildRole());
    document.getElementById('choose-signin-btn')?.addEventListener('click', () => this.handleChooseSignIn());
    document.getElementById('continue-child-btn')?.addEventListener('click', () => this.handleChooseChild());
    document.getElementById('back-to-role-btn')?.addEventListener('click', () => this.handleBackToRole());
    document.getElementById('back-from-parent-btn')?.addEventListener('click', () => this.handleBackToRole());
    document.getElementById('send-otp-btn')?.addEventListener('click', () => this.handleSendOTP());
    document.getElementById('verify-otp-btn')?.addEventListener('click', () => this.handleVerifyOTP());
    document.getElementById('resend-otp-btn')?.addEventListener('click', () => this.handleResendOTP());
    document.getElementById('create-team-btn')?.addEventListener('click', () => this.handleCreateTeam());

    const emailInput = document.getElementById('email-input');
    const childJoinCodeInput = document.getElementById('role-family-code-input');
    emailInput?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.handleSendOTP();
      }
    });

    childJoinCodeInput?.addEventListener('input', () => {
      childJoinCodeInput.value = this.normalizeJoinCode(childJoinCodeInput.value);
      this.showFieldError('role-error', '');
    });

    childJoinCodeInput?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.handleChooseChild();
      }
    });

    if (this.getCurrentLaunchState().isRegistrationOpen) {
      await this.maybeShowRegisterInviteLetter();
      await this.initPrelaunchRegisterPage();
      return;
    }

    await this.maybeShowRegisterInviteLetter();
    await this.initPostLaunchRegisterPage();
  },

  async initPrelaunchRegisterPage() {
    this.state.registerIntent = 'role';
    this.setRegisterIntro('', '');
    this.setRegisterEmailMode('register');
    this.syncRegisterEmailInput({ lockToSession: Boolean(this.state.session) });
    this.setRegisteredConfirmation(this.state.registration);
    this.updateRegisterRoleSummary();
    this.setButtonLabel(document.getElementById('send-otp-btn'), this.state.session ? 'Continue' : 'Send verification code');
    if (this.state.parentInviteToken) {
      this.showPageMessage('register-page-message', 'A child asked you to register a family. Sign in as a Parent and we will add them when you create it.');
    }

    if (!this.state.session) {
      this.showStep('role');
      return;
    }

    const status = await this.fetchRegistrationStatus({ suppressMissing: true });
    if (status?.registration) {
      if (status.launch?.isNormalParticipationOpen) {
        await this.routePostLaunchRegisterUser();
      } else {
        this.showRegisteredConfirmation(status.registration);
      }
      return;
    }

    this.showStep('role');
  },

  async initPostLaunchRegisterPage() {
    this.state.registerIntent = 'signin';
    this.setRegisterIntro('Sign in', 'Use your email to continue into FamHack.');
    this.setRegisterEmailMode('signin');
    this.syncRegisterEmailInput({ lockToSession: Boolean(this.state.session) });
    this.setButtonLabel(document.getElementById('send-otp-btn'), this.state.session ? 'Continue' : 'Send sign-in code');
    if (this.state.parentInviteToken) {
      this.showPageMessage('register-page-message', 'A child asked you to register a family. Sign in as a Parent and we will add them when you create it.');
    }

    const backButton = document.getElementById('back-from-parent-btn');
    if (backButton) {
      backButton.hidden = true;
    }

    if (!this.state.session) {
      this.showStep('email');
      return;
    }

    await this.routePostLaunchRegisterUser();
  },

  async routePostLaunchRegisterUser() {
    const dashboard = await this.fetchDashboard({ suppressMissing: true });
    if (dashboard) {
      this.redirectToDashboard();
      return;
    }

    const status = await this.fetchRegistrationStatus({ suppressMissing: true });
    const registration = status?.registration || null;

    if (!registration?.role) {
      this.showStep('email');
      this.showPageMessage('register-page-message', 'Registration has closed for this account.');
      return;
    }

    this.state.registration = registration;

    if (!status?.launch?.isNormalParticipationOpen) {
      this.showRegisteredConfirmation(registration);
      return;
    }

    if (registration.role === 'parent') {
      this.redirectToDashboard();
      return;
    }

    if (status?.childPoolEntry || status?.parentInvite) {
      this.redirectToDashboard();
      return;
    }

    this.redirect('/join');
  },

  async initJoinPage() {
    this.bindInviteLetterModal();
    document.getElementById('send-otp-btn')?.addEventListener('click', () => this.handleSendOTP());
    document.getElementById('verify-otp-btn')?.addEventListener('click', () => this.handleVerifyOTP());
    document.getElementById('resend-otp-btn')?.addEventListener('click', () => this.handleResendOTP());
    document.getElementById('continue-from-focus-btn')?.addEventListener('click', () => this.handleContinueFromFocus());
    document.getElementById('request-join-btn')?.addEventListener('click', () => this.handleJoinRequest());
    document.getElementById('join-pool-btn')?.addEventListener('click', () => this.handleJoinPool());
    document.getElementById('invite-parent-btn')?.addEventListener('click', () => this.handleInviteParent());
    document.getElementById('go-code-join-btn')?.addEventListener('click', () => this.handleChooseJoinWithCode());
    document.getElementById('go-pool-join-btn')?.addEventListener('click', () => this.handleChooseJoinPool());
    document.getElementById('go-parent-invite-btn')?.addEventListener('click', () => this.handleChooseInviteParent());
    document.getElementById('back-to-email-from-choice-btn')?.addEventListener('click', () => this.showStep('email'));
    document.getElementById('back-to-choice-from-route-btn')?.addEventListener('click', () => this.showJoinChoiceStep());
    document.getElementById('back-to-route-from-code-btn')?.addEventListener('click', () => this.showJoinRouteStep());
    document.getElementById('back-to-route-from-pool-btn')?.addEventListener('click', () => this.showJoinRouteStep());
    document.getElementById('back-to-route-from-invite-btn')?.addEventListener('click', () => this.showJoinRouteStep());
    document.querySelectorAll('[data-child-join-mode-card]').forEach((card) => {
      card.addEventListener('click', () => this.setChildJoinMode(card.dataset.childJoinModeCard));
    });
    document.querySelectorAll('[data-child-focus-card]').forEach((card) => {
      card.addEventListener('click', () => {
        this.setChildFocus(card.dataset.childFocusCard);
        this.showFieldError('join-choice-error', '');
        this.showFieldError('join-request-error', '');
        this.showFieldError('join-pool-error', '');
        this.showFieldError('parent-invite-error', '');
      });
    });

    const joinCodeInput = document.getElementById('join-code-input');
    const joinCodeStepInput = document.getElementById('join-code-step-input');
    const emailInput = document.getElementById('email-input');
    const codeFromUrl = new URLSearchParams(window.location.search).get('code')
      || new URLSearchParams(window.location.search).get('t');

    if (codeFromUrl) {
      this.syncJoinCodeInputs(codeFromUrl);
      await this.lookupTeam(this.getJoinCodeValue(), { showErrors: false });
    }

    this.maybeShowJoinInviteLetter();
    this.syncJoinInterfaceForRole();

    const bindJoinCodeInput = (input) => {
      if (!input) {
        return;
      }

      input.addEventListener('input', () => {
        this.syncJoinCodeInputs(input.value);
        this.showJoinCodeError('');
        clearTimeout(this.state.joinLookupTimer);
        if (!this.getJoinCodeValue()) {
          this.renderTeamPreview(null);
          return;
        }
        this.state.joinLookupTimer = window.setTimeout(() => {
          this.lookupTeam(this.getJoinCodeValue(), { showErrors: false }).catch((error) => console.error(error));
        }, 250);
      });

      input.addEventListener('blur', () => {
        if (this.getJoinCodeValue()) {
          this.lookupTeam(this.getJoinCodeValue(), { showErrors: false }).catch((error) => console.error(error));
        }
      });
    };

    bindJoinCodeInput(joinCodeInput);
    bindJoinCodeInput(joinCodeStepInput);

    emailInput?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.handleSendOTP();
      }
    });

    if (this.state.session) {
      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (dashboard) {
        this.redirectToDashboard();
        return;
      }

      const canJoin = await this.ensureJoinAccess();
      if (!canJoin) {
        return;
      }

      if (emailInput && this.state.session.user?.email) {
        emailInput.value = this.state.session.user.email;
        emailInput.disabled = true;
      }

      this.setButtonLabel(document.getElementById('send-otp-btn'), 'Continue');
      await this.resumeJoinFlow();
    }
  },

  async initDashboardPage() {
    document.getElementById('copy-invite-btn')?.addEventListener('click', () => this.copyFieldValue('invite-link-input', 'copy-invite-btn'));
    document.getElementById('copy-code-btn')?.addEventListener('click', () => this.copyFieldValue('join-code-display', 'copy-code-btn'));
    document.getElementById('email-invite-btn')?.addEventListener('click', () => this.openInviteEmail());
    document.getElementById('sign-out-btn')?.addEventListener('click', () => this.handleSignOut());
    document.getElementById('leave-team-btn')?.addEventListener('click', () => this.handleLeaveTeam());
    document.getElementById('danger-toggle-btn')?.addEventListener('click', () => this.toggleDangerPanel());
    document.getElementById('create-team-btn')?.addEventListener('click', () => this.handleCreateTeam());
    document.querySelectorAll('[data-parent-team-kind-card]').forEach((card) => {
      card.addEventListener('click', () => {
        if (this.state.parentInviteToken && card.dataset.parentTeamKindCard === 'volunteer') {
          return;
        }
        this.setParentTeamKind(card.dataset.parentTeamKindCard);
      });
    });

    if (!this.state.session) {
      this.redirect('/register');
      return;
    }

    this.setDashboardLoading(true);
    await this.loadDashboard();
  },

  async initCtfPage() {
    const signOutButton = document.getElementById('ctf-sign-out-btn');
    const challengeShell = document.getElementById('ctf-challenge-shell');
    const sigintModal = document.getElementById('ctf-sigint-modal');
    const finalInfoModal = document.getElementById('ctf-final-info-modal');
    signOutButton?.addEventListener('click', () => this.handleSignOut());
    if (signOutButton) {
      signOutButton.hidden = !this.state.session;
    }
    challengeShell?.addEventListener('submit', (event) => this.handleCtfSubmit(event));
    challengeShell?.addEventListener('submit', (event) => {
      if (event.target.closest('[data-ctf-prize-claim-form]')) {
        this.handleCtfPrizeClaim(event);
      }
    });
    challengeShell?.addEventListener('click', (event) => {
      const nextButton = event.target.closest('[data-ctf-next]');
      if (nextButton) {
        this.advanceSolvedCtfChallenge();
        return;
      }

      const sigintOpenButton = event.target.closest('[data-ctf-sigint-open]');
      if (sigintOpenButton) {
        this.openCtfSigintModal();
        return;
      }
    });
    sigintModal?.addEventListener('click', (event) => {
      if (event.target === sigintModal || event.target.closest('[data-ctf-sigint-close]')) {
        this.closeCtfSigintModal();
      }
    });
    finalInfoModal?.addEventListener('submit', (event) => {
      if (event.target.closest('[data-ctf-final-year-gate-form]')) {
        this.handleCtfFinalYearGate(event);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeCtfSigintModal();
      }
      this.handleKonamiKeydown(event);
    });

    this.setCtfLoading(true);
    await this.loadCtfState();
  },

  handleChooseParent() {
    this.state.registerIntent = 'parent';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterEmailMode('register');
    this.setRegisterIntro(
      'Verify your email',
      'You are joining as a Parent.'
    );

    this.syncRegisterEmailInput({ lockToSession: Boolean(this.state.session) });
    this.updateRegisterRoleSummary();
    this.setButtonLabel(document.getElementById('send-otp-btn'), this.state.session ? 'Continue' : 'Send verification code');
    this.showStep('email');
    document.getElementById('email-input')?.focus();
  },

  handleChooseSignIn() {
    this.state.registerIntent = 'signin';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterEmailMode('signin');
    this.setRegisterIntro(
      'Sign in',
      'Use your email to continue into FamHack.'
    );

    if (this.state.session) {
      this.routePostLaunchRegisterUser().catch((error) => {
        console.error(error);
        this.showPageMessage('register-page-message', error.message || 'Unable to continue right now.');
      });
      return;
    }

    this.syncRegisterEmailInput({ lockToSession: false });
    this.setButtonLabel(document.getElementById('send-otp-btn'), 'Send sign-in code');
    this.showStep('email');
    document.getElementById('email-input')?.focus();
  },

  handleChooseChildRole() {
    this.state.registerIntent = 'child';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterIntro(
      'Verify your email',
      'You are joining as a Child.'
    );

    this.syncRegisterEmailInput({ lockToSession: Boolean(this.state.session) });
    this.updateRegisterRoleSummary();
    this.setButtonLabel(document.getElementById('send-otp-btn'), this.state.session ? 'Continue' : 'Send verification code');
    this.showStep('email');
    document.getElementById('email-input')?.focus();
  },

  handleChooseChild() {
    const joinCodeInput = document.getElementById('role-family-code-input');
    const joinCode = this.normalizeJoinCode(joinCodeInput?.value);

    if (joinCodeInput) {
      joinCodeInput.value = joinCode;
    }

    const target = joinCode ? `/join?code=${encodeURIComponent(joinCode)}` : '/join';
    this.redirect(target);
  },

  handleBackToRole() {
    this.showFieldError('role-error', '');
    this.showFieldError('email-error', '');
    this.showFieldError('otp-error', '');

    if (this.getCurrentLaunchState().isRegistrationOpen) {
      this.state.registerIntent = 'role';
      this.setRegisterEmailMode('register');
      this.setRegisterIntro('', '');
      this.updateRegisterRoleSummary();
      this.showStep('role');
      return;
    }

    this.state.registerIntent = 'signin';
    this.setRegisterEmailMode('signin');
    this.setRegisterIntro('Sign in', 'Use your email to continue into FamHack.');
    this.showStep('email');
  },

  async fetchRegistrationStatus({ suppressMissing } = {}) {
    try {
      const payload = await this.apiRequest('/api/registration/status');
      this.state.registration = payload.registration || null;
      this.state.registrationStatus = payload || null;
      if (payload?.profile?.childFocus) {
        this.setChildFocus(payload.profile.childFocus);
      }
      if (payload?.profile) {
        this.prefillChildProfileFields(payload.profile);
      }
      if (payload?.parentInvite) {
        this.prefillParentInviteEmail(payload.parentInvite);
      }
      if (payload?.launch) {
        this.state.launch = payload.launch;
      }
      return payload;
    } catch (error) {
      if (suppressMissing && (error.status === 401 || error.status === 404)) {
        this.state.registration = null;
        this.state.registrationStatus = null;
        return null;
      }
      throw error;
    }
  },

  showRegisteredConfirmation(registration, message = '') {
    this.setRegisteredConfirmation(registration);
    this.showStep('registered');
    this.showPageMessage('register-page-message', message);
  },

  async completePrelaunchRegistration() {
    const requestedRole = this.state.registerIntent;
    if (!['parent', 'child'].includes(requestedRole)) {
      this.showFieldError('role-error', 'Choose Parent or Child before continuing.');
      this.handleBackToRole();
      return;
    }

    try {
      const payload = await this.apiRequest('/api/registration/complete', {
        method: 'POST',
        body: {
          role: requestedRole,
        },
      });

      this.state.registration = payload.registration || null;

      const status = await this.fetchRegistrationStatus({ suppressMissing: true });
      if (status?.launch?.isNormalParticipationOpen) {
        await this.routePostLaunchRegisterUser();
        return;
      }

      this.showRegisteredConfirmation(payload.registration);
    } catch (error) {
      if (error.status === 409 && error.details?.registration) {
        this.state.registration = error.details.registration;

        const status = await this.fetchRegistrationStatus({ suppressMissing: true });
        if (status?.launch?.isNormalParticipationOpen) {
          await this.routePostLaunchRegisterUser();
          return;
        }

        this.showRegisteredConfirmation(error.details.registration, error.message);
        return;
      }

      throw error;
    }
  },

  async ensureJoinAccess() {
    const status = await this.fetchRegistrationStatus({ suppressMissing: true });
    if (status?.registration?.role) {
      this.state.registration = status.registration;
      this.syncJoinInterfaceForRole(status.registration.role);
      return true;
    }

    this.redirect('/register');
    return false;
  },

  showJoinChoiceStep(message = '') {
    if (this.getJoinRegistrationRole() !== 'child') {
      this.showStep('email');
      this.showPageMessage('join-page-message', message || 'Enter a family code to continue.');
      return;
    }

    this.syncJoinInterfaceForRole('child');
    this.updateChildFocusSummary();
    this.showFieldError('join-choice-error', '');
    this.showStep('child-choice');
    this.showPageMessage('join-page-message', message);
  },

  showJoinRouteStep(message = '') {
    if (this.getJoinRegistrationRole() !== 'child') {
      return false;
    }

    const focus = this.ensureChildFocus('join-choice-error');
    if (!focus) {
      return false;
    }

    this.showFieldError('join-choice-error', '');
    this.showFieldError('join-route-error', '');
    this.showStep('child-route');
    this.showPageMessage('join-page-message', message);
    return true;
  },

  showJoinModeStep(mode, { message = '', skipFocusCheck = false } = {}) {
    const role = this.getJoinRegistrationRole();
    const isChild = role === 'child';
    const focus = isChild
      ? (skipFocusCheck ? this.getSelectedChildFocus() : this.ensureChildFocus('join-choice-error'))
      : '';

    if (isChild && !skipFocusCheck && !focus) {
      return false;
    }

    if (!isChild && mode !== 'code') {
      return false;
    }

    this.syncJoinInterfaceForRole(role);
    this.setChildJoinMode(isChild ? mode : 'code');
    this.updateChildFocusSummary();
    this.showFieldError('join-choice-error', '');
    this.showFieldError('join-route-error', '');
    this.showFieldError('join-request-error', '');
    this.showFieldError('join-pool-error', '');
    this.showFieldError('parent-invite-error', '');

    if (mode === 'code') {
      this.showStep('join-team');
    } else if (isChild && mode === 'pool') {
      this.showStep('join-pool');
    } else if (isChild && mode === 'invite') {
      this.prefillParentInviteEmail(this.state.registrationStatus?.parentInvite);
      this.showStep('invite-parent');
    } else {
      return false;
    }

    this.showPageMessage('join-page-message', message);
    return true;
  },

  async resumeJoinFlow({ justVerified = false } = {}) {
    const status = this.state.registrationStatus || await this.fetchRegistrationStatus({ suppressMissing: true });
    const role = status?.registration?.role || this.getJoinRegistrationRole();
    const joinMode = this.getJoinModeParam();
    const activeRoute = this.getActiveChildRoute(status);
    const hasJoinCode = Boolean(this.getJoinCodeValue());
    const currentFocus = this.getSelectedChildFocus();
    const explicitMode = joinMode || '';
    const savedMode = activeRoute || (hasJoinCode ? 'code' : '');

    this.syncJoinInterfaceForRole(role);

    if (status?.parentInvite) {
      this.prefillParentInviteEmail(status.parentInvite);
    }

    if (role === 'parent') {
      if (this.state.teamPreview) {
        this.showJoinModeStep('code', {
          message: justVerified
            ? `Verified. Review ${this.state.teamPreview.name} and send your request.`
            : `Review ${this.state.teamPreview.name} and send your request.`,
          skipFocusCheck: true,
        });
        return;
      }

      this.showStep('email');
      this.showPageMessage(
        'join-page-message',
        justVerified ? 'Verified. Enter a family code to continue.' : 'Enter a family code to continue.'
      );
      return;
    }

    if (savedMode) {
      this.setChildJoinMode(savedMode);
    }

    if (explicitMode === 'pool' && currentFocus) {
      this.showJoinModeStep('pool', {
        message: 'Review your random-family pool details.',
        skipFocusCheck: true,
      });
      return;
    }

    if (explicitMode === 'invite' && currentFocus) {
      this.showJoinModeStep('invite', {
        message: 'Update your parent invite.',
        skipFocusCheck: true,
      });
      return;
    }

    if (explicitMode === 'code' && this.state.teamPreview && currentFocus) {
      this.showJoinModeStep('code', {
        message: `Review ${this.state.teamPreview.name} and submit your request.`,
        skipFocusCheck: true,
      });
      return;
    }

    if (activeRoute === 'pool') {
      this.showJoinModeStep('pool', {
        message: 'Review or update your random-family pool entry.',
        skipFocusCheck: true,
      });
      return;
    }

    if (activeRoute === 'invite') {
      const parentEmail = status?.parentInvite?.parentEmail || '';
      this.showJoinModeStep('invite', {
        message: parentEmail ? `Parent invite ready for ${parentEmail}.` : 'Review your parent invite.',
        skipFocusCheck: true,
      });
      return;
    }

    if (!currentFocus) {
      this.showJoinChoiceStep(
        this.state.teamPreview
          ? (justVerified
            ? `Verified. Choose your track first, then you can join ${this.state.teamPreview.name}.`
            : `Choose your track first, then you can join ${this.state.teamPreview.name}.`)
          : (justVerified ? 'Verified. Choose your track first.' : 'Choose your track first.')
      );
      return;
    }

    this.showJoinRouteStep(
      this.state.teamPreview
        ? `Track saved. Choose how you want to join ${this.state.teamPreview.name}.`
        : 'Track saved. Choose how you want to join.'
    );
  },

  handleContinueFromFocus() {
    this.showJoinRouteStep('Choose how you want to join.');
  },

  handleChooseJoinWithCode() {
    this.showJoinModeStep('code', {
      message: this.state.teamPreview
        ? 'Review the family below and submit your request.'
        : 'Enter a family code, then submit your request.',
    });
  },

  handleChooseJoinPool() {
    this.showJoinModeStep('pool', {
      message: 'Enter the random-family pool.',
    });
  },

  handleChooseInviteParent() {
    this.showJoinModeStep('invite', {
      message: 'Enter one parent email and FamHack will send them your invite link.',
    });
  },

  async handleSendOTP() {
    const launch = this.getCurrentLaunchState();
    const sendButton = document.getElementById('send-otp-btn');
    const emailInput = document.getElementById('email-input');
    const email = this.normalizeEmail(this.state.session?.user?.email || emailInput?.value);

    this.showFieldError('email-error', '');
    this.showJoinCodeError('');

    if (this.state.page === 'join') {
      const joinCode = this.getJoinCodeValue();
      this.syncJoinCodeInputs(joinCode);
      if (!joinCode) {
        this.renderTeamPreview(null);
        this.showJoinCodeError('');
      }
    }

    if (this.state.session) {
      if (this.state.page === 'register') {
        if (launch.isRegistrationOpen) {
          await this.completePrelaunchRegistration();
        } else {
          await this.routePostLaunchRegisterUser();
        }
      } else if (this.state.page === 'join') {
        const canJoin = await this.ensureJoinAccess();
        if (!canJoin) {
          return;
        }

        if (this.getJoinRegistrationRole() === 'parent') {
          const joinCode = this.getJoinCodeValue();
          if (!joinCode) {
            this.showJoinCodeError('Enter a valid family code');
            this.showStep('email');
            return;
          }

          const team = this.state.teamPreview || await this.lookupTeam(joinCode, { showErrors: true });
          if (!team) {
            this.showStep('email');
            return;
          }

          this.showJoinModeStep('code', {
            message: `Review ${team.name} and send your request.`,
            skipFocusCheck: true,
          });
        } else {
          await this.resumeJoinFlow();
        }
      }
      return;
    }

    if (!this.validateEmail(email)) {
      this.showFieldError('email-error', this.getEmailValidationMessage());
      return;
    }

    this.setButtonState(sendButton, {
      busy: true,
      label: 'Sending...',
      idleLabel: this.state.page === 'join'
        ? (this.state.session ? 'Continue' : 'Send OTP')
        : launch.isRegistrationOpen
          ? 'Send verification code'
          : 'Send sign-in code',
    });

    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) {
        throw error;
      }

      this.state.pendingEmail = email;
      this.showStep('otp');
      this.startResendCountdown();
      document.querySelector('.otp-digit')?.focus();
      this.showPageMessage(
        this.state.page === 'register' ? 'register-page-message' : 'join-page-message',
        'Verification code sent. Check your inbox.'
      );
    } catch (error) {
      console.error(error);
      this.showFieldError('email-error', error.message || 'Unable to send verification code');
    } finally {
      this.setButtonState(sendButton, {
        busy: false,
        label: 'Sending...',
        idleLabel: this.state.page === 'join'
          ? (this.state.session ? 'Continue' : 'Send OTP')
          : launch.isRegistrationOpen
            ? 'Send verification code'
            : 'Send sign-in code',
      });
    }
  },

  async handleVerifyOTP() {
    const launch = this.getCurrentLaunchState();
    const verifyButton = document.getElementById('verify-otp-btn');
    const emailInput = document.getElementById('email-input');
    const otp = this.getOTPValue();
    const email = this.state.pendingEmail || this.normalizeEmail(emailInput?.value);

    this.showFieldError('otp-error', '');

    if (otp.length !== this.config.otpLength) {
      this.showFieldError('otp-error', `Enter the full ${this.config.otpLength}-digit code`);
      return;
    }

    this.setButtonState(verifyButton, {
      busy: true,
      label: 'Verifying...',
      idleLabel: 'Verify',
    });

    try {
      const data = await this.verifyEmailOtp(email, otp);

      this.state.session = data.session;

      if (this.state.page === 'register') {
        if (launch.isRegistrationOpen) {
          await this.completePrelaunchRegistration();
        } else {
          await this.routePostLaunchRegisterUser();
        }
      } else if (this.state.page === 'join') {
        const canJoin = await this.ensureJoinAccess();
        if (!canJoin) {
          return;
        }

        const joinCode = this.getJoinCodeValue();
        if (joinCode) {
          const team = this.state.teamPreview || await this.lookupTeam(joinCode, { showErrors: false });
          if (!team && this.getJoinRegistrationRole() === 'parent') {
            this.showJoinCodeError('That family code was not found');
            this.showStep('email');
            return;
          }
        }

        await this.resumeJoinFlow({ justVerified: true });
      }
    } catch (error) {
      console.error(error);
      this.showFieldError(
        'otp-error',
        error.status === 403 ? (error.message || 'This flow is not available yet.') : this.getFriendlyOtpErrorMessage(error)
      );
      this.clearOTPInputs();
    } finally {
      this.setButtonState(verifyButton, {
        busy: false,
        label: 'Verifying...',
        idleLabel: 'Verify',
      });
    }
  },

  async verifyEmailOtp(email, token) {
    const verificationTypes = ['email', 'signup'];
    let lastError = null;

    for (const type of verificationTypes) {
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token,
        type,
      });

      if (!error) {
        return data;
      }

      lastError = error;
    }

    throw lastError || new Error('Unable to verify that code');
  },

  async handleResendOTP() {
    const resendButton = document.getElementById('resend-otp-btn');
    if (!resendButton || resendButton.disabled || !this.state.pendingEmail) {
      return;
    }

    resendButton.disabled = true;
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email: this.state.pendingEmail,
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) {
        throw error;
      }

      this.clearOTPInputs();
      this.startResendCountdown();
    } catch (error) {
      console.error(error);
      this.showFieldError('otp-error', error.message || 'Unable to resend code');
      resendButton.disabled = false;
      resendButton.textContent = 'Resend OTP';
    }
  },

  startResendCountdown() {
    const resendButton = document.getElementById('resend-otp-btn');
    if (!resendButton) {
      return;
    }

    clearInterval(this.state.resendTimer);

    let remaining = this.config.otpResendDelay;
    resendButton.disabled = true;
    resendButton.textContent = `Resend in ${remaining}s`;

    this.state.resendTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(this.state.resendTimer);
        resendButton.disabled = false;
        resendButton.textContent = 'Resend OTP';
      } else {
        resendButton.textContent = `Resend in ${remaining}s`;
      }
    }, 1000);
  },

  async lookupTeam(joinCode, { showErrors }) {
    const normalizedCode = this.normalizeJoinCode(joinCode);
    if (!normalizedCode) {
      this.renderTeamPreview(null);
      return null;
    }

    try {
      const response = await fetch(`/api/team/lookup?code=${encodeURIComponent(normalizedCode)}`);
      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          this.renderTeamPreview(null);
          if (showErrors) {
            this.showJoinCodeError(payload.error || 'That family code was not found');
          }
          return null;
        }
        throw new Error(payload.error || 'Unable to verify that family code');
      }

      this.state.teamPreview = payload.team;
      this.renderTeamPreview(payload.team);
      return payload.team;
    } catch (error) {
      console.error(error);
      if (showErrors) {
        this.showJoinCodeError(error.message || 'Unable to verify that family code');
      }
      return null;
    }
  },

  renderTeamPreview(team) {
    const preview = document.getElementById('team-preview');
    const previewName = document.getElementById('team-preview-name');
    const joinTeamName = document.getElementById('join-team-id');
    const joinTeamPreviewCard = document.getElementById('join-team-preview-card');

    this.state.teamPreview = team || null;

    if (preview) {
      preview.hidden = !team;
    }

    if (joinTeamPreviewCard) {
      joinTeamPreviewCard.hidden = !team;
    }

    if (previewName) {
      previewName.textContent = team?.name || '';
    }

    if (joinTeamName) {
      joinTeamName.textContent = team?.name || '';
    }
  },

  async handleCreateTeam() {
    const createButton = document.getElementById('create-team-btn');
    const fullName = document.getElementById('full-name-input')?.value?.trim() || '';
    const studyYear = this.getSelectedStudyYear();
    const teamName = document.getElementById('team-name-input')?.value?.trim() || '';
    const teamKind = this.getParentTeamKind();

    this.showFieldError('team-error', '');

    if (!fullName) {
      this.showFieldError('team-error', 'Your name is required');
      return;
    }

    if (teamName.length < 3) {
      this.showFieldError('team-error', 'Choose a team name with at least 3 characters');
      return;
    }

    if (!studyYear) {
      this.showFieldError('team-error', 'Choose your year of study');
      return;
    }

    this.setButtonState(createButton, {
      busy: true,
      label: 'Creating...',
      idleLabel: teamKind === 'volunteer' ? 'Become a Volunteer Parent' : 'Create a Family',
    });

    try {
      await this.apiRequest('/api/team/create', {
        method: 'POST',
        body: {
          fullName,
          studyYear,
          teamName,
          teamKind,
          ...(this.state.parentInviteToken ? { parentInviteToken: this.state.parentInviteToken } : {}),
        },
      });

      this.clearStoredParentInviteToken();
      this.redirectToDashboard();
    } catch (error) {
      console.error(error);
      if (
        String(error.message || '').includes('parent invite')
        || String(error.message || '').includes('different email address')
      ) {
        this.clearStoredParentInviteToken();
      }
      this.showFieldError('team-error', error.message || 'Unable to create your family');
    } finally {
      this.setButtonState(createButton, {
        busy: false,
        label: 'Creating...',
        idleLabel: teamKind === 'volunteer' ? 'Become a Volunteer Parent' : 'Create a Family',
      });
    }
  },

  async handleJoinRequest() {
    const joinButton = document.getElementById('request-join-btn');
    const fullName = document.getElementById('full-name-input')?.value?.trim() || '';
    const studyYear = this.getSelectedStudyYear();
    const role = this.getJoinRegistrationRole();
    const childFocus = role === 'child' ? this.ensureChildFocus('join-request-error') : '';
    const joinCode = this.getJoinCodeValue();

    this.showFieldError('join-request-error', '');
    this.showJoinCodeError('');

    if (role === 'child' && !childFocus) {
      return;
    }

    if (!fullName) {
      this.showFieldError('join-request-error', 'Your name is required');
      return;
    }

    if (!studyYear) {
      this.showFieldError('join-request-error', 'Choose your year of study');
      return;
    }

    if (!joinCode) {
      this.showJoinCodeError('Enter a valid family code');
      return;
    }

    if (!this.state.teamPreview) {
      const team = await this.lookupTeam(joinCode, { showErrors: true });
      if (!team) {
        this.showJoinModeStep('code', {
          message: 'Enter a valid family code to continue.',
          skipFocusCheck: true,
        });
        return;
      }
    }

    this.setButtonState(joinButton, {
      busy: true,
      label: 'Submitting...',
      idleLabel: 'Request to Join',
    });

    try {
      await this.apiRequest('/api/team/join', {
        method: 'POST',
        body: {
          fullName,
          studyYear,
          joinCode,
          ...(role === 'child' ? { childFocus } : {}),
        },
      });

      this.redirectToDashboard();
    } catch (error) {
      console.error(error);
      this.showFieldError('join-request-error', error.message || 'Unable to submit join request');
    } finally {
      this.setButtonState(joinButton, {
        busy: false,
        label: 'Submitting...',
        idleLabel: 'Request to Join',
      });
    }
  },

  async handleJoinPool() {
    const joinPoolButton = document.getElementById('join-pool-btn');
    const fullName = document.getElementById('pool-full-name-input')?.value?.trim() || '';
    const studyYear = String(document.getElementById('pool-study-year-input')?.value || '').trim();
    const childFocus = this.ensureChildFocus('join-pool-error');

    this.showFieldError('join-pool-error', '');

    if (!childFocus) {
      return;
    }

    if (!fullName) {
      this.showFieldError('join-pool-error', 'Your name is required');
      return;
    }

    if (!studyYear) {
      this.showFieldError('join-pool-error', 'Choose your year of study');
      return;
    }

    this.setButtonState(joinPoolButton, {
      busy: true,
      label: 'Joining...',
      idleLabel: 'Enter Random Family Pool',
    });

    try {
      await this.apiRequest('/api/child/pool', {
        method: 'POST',
        body: {
          fullName,
          studyYear,
          childFocus,
        },
      });

      this.redirectToDashboard();
    } catch (error) {
      console.error(error);
      this.showFieldError('join-pool-error', error.message || 'Unable to join the child pool');
    } finally {
      this.setButtonState(joinPoolButton, {
        busy: false,
        label: 'Joining...',
        idleLabel: 'Enter Random Family Pool',
      });
    }
  },

  async handleInviteParent() {
    const inviteButton = document.getElementById('invite-parent-btn');
    const childName = document.getElementById('invite-child-name-input')?.value?.trim() || '';
    const parentEmail = this.normalizeEmail(document.getElementById('parent-email-input')?.value);
    const studyYear = String(document.getElementById('invite-study-year-input')?.value || '').trim();
    const childFocus = this.ensureChildFocus('parent-invite-error');

    this.showFieldError('parent-invite-error', '');

    if (!childFocus) {
      return;
    }

    if (!childName) {
      this.showFieldError('parent-invite-error', 'Your name is required');
      return;
    }

    if (!studyYear) {
      this.showFieldError('parent-invite-error', 'Choose your year of study');
      return;
    }

    if (!parentEmail) {
      this.showFieldError('parent-invite-error', 'Enter a parent email address');
      return;
    }

    this.setButtonState(inviteButton, {
      busy: true,
      label: 'Sending...',
      idleLabel: 'Send Parent Invite',
    });

    try {
      await this.apiRequest('/api/child/invite-parent', {
        method: 'POST',
        body: {
          childName,
          parentEmail,
          studyYear,
          childFocus,
        },
      });

      this.redirectToDashboard();
    } catch (error) {
      console.error(error);
      this.showFieldError('parent-invite-error', error.message || 'Unable to send the parent invite');
    } finally {
      this.setButtonState(inviteButton, {
        busy: false,
        label: 'Sending...',
        idleLabel: 'Send Parent Invite',
      });
    }
  },

  async apiRequest(path, options = {}) {
    const headers = {};
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.state.session?.access_token) {
      headers.Authorization = `Bearer ${this.state.session.access_token}`;
    }

    const response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let payload = {};

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = {};
      }
    }

    if (!response.ok) {
      const error = new Error(payload.error || 'Request failed');
      error.status = response.status;
      error.details = payload.details;
      throw error;
    }

    return payload;
  },

  async fetchCtfState() {
    return this.apiRequest('/api/ctf/state');
  },

  hasAcknowledgedCtfEntryNotice() {
    try {
      return window.localStorage.getItem('famhack-ctf-entry-notice-acknowledged') === '1';
    } catch (error) {
      return false;
    }
  },

  markCtfEntryNoticeAcknowledged() {
    try {
      window.localStorage.setItem('famhack-ctf-entry-notice-acknowledged', '1');
    } catch (error) {
      // Ignore storage failures and continue with the CTF page reveal.
    }
  },

  async waitForCtfIntroLoaderGate() {
    try {
      await window.FamHackCtfIntro?.waitForBoardLoader?.();
    } catch (error) {
      // Fall back to the normal loader flow if the intro gate is unavailable.
    }
  },

  resetCtfScrollPosition() {
    const smoother = window.ScrollSmoother?.get?.();

    if (smoother) {
      smoother.scrollTo(0, false);
    }

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);

    window.requestAnimationFrame(() => {
      const nextSmoother = window.ScrollSmoother?.get?.();
      if (nextSmoother) {
        nextSmoother.scrollTo(0, false);
      }
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  },

  async maybeShowCtfEntryNotice() {
    const notice = document.getElementById('ctf-entry-notice');
    const confirmButton = document.getElementById('ctf-entry-notice-confirm');
    const noticeCard = notice?.querySelector('.ctf-entry-notice-card');

    if (!notice || !confirmButton || this.hasAcknowledgedCtfEntryNotice()) {
      return;
    }

    notice.hidden = false;
    notice.style.opacity = '1';
    document.body.classList.add('ctf-entry-notice-open');
    this.resetCtfScrollPosition();

    if (typeof window.gsap !== 'undefined' && noticeCard) {
      window.gsap.fromTo(
        noticeCard,
        { opacity: 0, y: 22, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.34, ease: 'power2.out' },
      );
    }

    await new Promise((resolve) => {
      const handleConfirm = () => {
        this.markCtfEntryNoticeAcknowledged();
        document.body.classList.remove('ctf-entry-notice-open');
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        const finish = () => {
          notice.hidden = true;
          this.resetCtfScrollPosition();
          resolve();
        };

        if (typeof window.gsap !== 'undefined' && noticeCard) {
          window.gsap.to(noticeCard, {
            opacity: 0,
            y: -10,
            scale: 0.985,
            duration: 0.2,
            ease: 'power1.in',
            onComplete: finish,
          });
          window.gsap.to(notice, {
            opacity: 0,
            duration: 0.2,
            ease: 'power1.in',
            onComplete: () => {
              notice.style.opacity = '';
            },
          });
        } else {
          finish();
        }
      };

      confirmButton.addEventListener('click', handleConfirm, { once: true });
    });
  },

  logCtfSigintConsoleHint() {
    if (this.state.ctfSigintConsoleHintLogged) {
      return;
    }

    this.state.ctfSigintConsoleHintLogged = true;

    console.log('%cBackstage visitor detected.', 'color:#fc2f20;font-family:"Azeret Mono",monospace;font-size:15px;font-weight:700;');
    console.log('%cThe rabbit holes get deeper over at SIGINT.', 'color:#ffe9ce;font-family:"Azeret Mono",monospace;font-size:12px;');
    console.log('Website: https://sigint.mx/');
    console.log('Discord: https://discord.gg/2raDA8pbtd');
  },

  openCtfSigintModal() {
    const modal = document.getElementById('ctf-sigint-modal');
    const card = modal?.querySelector('.ctf-sigint-card');

    if (!modal || this.state.ctfSigintModalOpen) {
      return;
    }

    this.state.ctfSigintModalOpen = true;
    modal.hidden = false;
    modal.style.opacity = '1';
    document.body.classList.add('ctf-sigint-modal-open');
    this.logCtfSigintConsoleHint();

    if (typeof window.gsap !== 'undefined' && card) {
      window.gsap.fromTo(
        card,
        { opacity: 0, y: 24, scale: 0.986 },
        { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'power2.out' },
      );
    }
  },

  closeCtfSigintModal(options = {}) {
    const modal = document.getElementById('ctf-sigint-modal');
    const card = modal?.querySelector('.ctf-sigint-card');

    if (!modal || (!this.state.ctfSigintModalOpen && modal.hidden)) {
      return;
    }

    this.state.ctfSigintModalOpen = false;
    document.body.classList.remove('ctf-sigint-modal-open');

    const finish = () => {
      modal.hidden = true;
      modal.style.opacity = '';
    };

    if (options.silent || typeof window.gsap === 'undefined' || !card) {
      finish();
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    window.gsap.to(card, {
      opacity: 0,
      y: -10,
      scale: 0.986,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: finish,
    });
    window.gsap.to(modal, {
      opacity: 0,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: () => {
        modal.style.opacity = '';
      },
    });
  },

  openCtfFinalInfoModal() {
    const modal = document.getElementById('ctf-final-info-modal');
    const card = modal?.querySelector('.ctf-sigint-card');

    if (!modal || this.state.ctfFinalInfoModalOpen || this.state.ctfFinalChallengeEligible) {
      return;
    }

    this.state.ctfFinalInfoModalOpen = true;
    modal.hidden = false;
    modal.style.opacity = '1';
    document.body.classList.add('ctf-final-info-modal-open');
    this.showFieldError('ctf-final-year-gate-error', '');

    if (typeof window.gsap !== 'undefined' && card) {
      window.gsap.fromTo(
        card,
        { opacity: 0, y: 24, scale: 0.986 },
        { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'power2.out' },
      );
    }

    // This looks a bit odd, but replaying the real modal submit keeps the L6 scroll reveal
    // matching the normal Year 1 path. Pre-setting the state directly changed the render.
    if (this.hasStoredCtfFinalYearApproval() && !this.state.ctfFinalAutoGateRunning) {
      const form = modal.querySelector('[data-ctf-final-year-gate-form]');
      const select = modal.querySelector('#ctf-final-year-gate-select');

      this.state.ctfFinalAutoGateRunning = true;
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
      modal.style.pointerEvents = 'none';
      if (select) {
        select.value = 'year_1';
      }

      window.requestAnimationFrame(() => {
        this.handleCtfFinalYearGate({
          preventDefault() {},
          target: form,
        });
        this.state.ctfFinalAutoGateRunning = false;
      });
    }
  },

  closeCtfFinalInfoModal(options = {}) {
    const modal = document.getElementById('ctf-final-info-modal');
    const card = modal?.querySelector('.ctf-sigint-card');
    const onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;

    if (!modal || (!this.state.ctfFinalInfoModalOpen && modal.hidden)) {
      onComplete?.();
      return;
    }

    this.state.ctfFinalInfoModalOpen = false;
    document.body.classList.remove('ctf-final-info-modal-open');

    const finish = () => {
      modal.hidden = true;
      modal.style.opacity = '';
      modal.style.visibility = '';
      modal.style.pointerEvents = '';
      onComplete?.();
    };

    if (options.silent || typeof window.gsap === 'undefined' || !card) {
      finish();
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    window.gsap.to(card, {
      opacity: 0,
      y: -10,
      scale: 0.986,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: finish,
    });
    window.gsap.to(modal, {
      opacity: 0,
      duration: 0.2,
      ease: 'power1.in',
      onComplete: () => {
        modal.style.opacity = '';
      },
    });
  },

  hasStoredCtfFinalYearApproval() {
    try {
      return window.localStorage.getItem('famhack-ctf-final-year-approved') === 'year_1';
    } catch (error) {
      return false;
    }
  },

  persistCtfFinalYearApproval(isApproved) {
    try {
      if (isApproved) {
        window.localStorage.setItem('famhack-ctf-final-year-approved', 'year_1');
      } else {
        window.localStorage.removeItem('famhack-ctf-final-year-approved');
      }
    } catch (error) {
      // Ignore storage failures and keep the gate session-local.
    }
  },

  handleCtfFinalYearGate(event) {
    const form = event.target.closest('[data-ctf-final-year-gate-form]');
    if (!form) {
      return;
    }

    event.preventDefault();

    const select = form.querySelector('#ctf-final-year-gate-select');
    const submitButton = form.querySelector('.ctf-entry-notice-confirm');
    const studyYear = String(select?.value || '').trim().toLowerCase();

    this.showFieldError('ctf-final-year-gate-error', '');

    if (!studyYear) {
      this.showFieldError('ctf-final-year-gate-error', 'Choose your year of study.');
      select?.focus();
      return;
    }

    if (studyYear !== 'year_1') {
      this.state.ctfFinalChallengeEligible = false;
      this.persistCtfFinalYearApproval(false);
      this.showFieldError('ctf-final-year-gate-error', 'You are not eligible to solve this problem.');
      return;
    }

    this.setButtonState(submitButton, {
      busy: true,
      label: 'Continuing...',
      idleLabel: 'Continue',
    });

    this.state.ctfFinalChallengeEligible = true;
    this.state.ctfFinalRevealComplete = false;
    this.persistCtfFinalYearApproval(true);
    this.renderCtfChallenge();
    this.setButtonState(submitButton, {
      busy: false,
      label: 'Continuing...',
      idleLabel: 'Continue',
    });
    this.closeCtfFinalInfoModal();
  },

  cleanupCtfFinalScrollGate() {
    if (typeof this.state.ctfFinalScrollCleanup === 'function') {
      this.state.ctfFinalScrollCleanup();
    }

    this.state.ctfFinalScrollCleanup = null;
  },

  buildCtfChallengeFormFieldsMarkup(challenge, ctf, promptMarkup, assetMarkup) {
    return `
      <p class="ctf-step-kicker">Challenge ${challenge.number} / ${ctf.challengeCount}</p>
      <h2 class="ctf-challenge-title">${this.escapeHtml(challenge.title)}</h2>
      ${promptMarkup}
      ${challenge.body ? `<p class="ctf-challenge-clue">${this.escapeHtml(challenge.body)}</p>` : ''}
      ${assetMarkup}
      <div class="form-group">
        <label class="form-label" for="ctf-answer-input">${this.escapeHtml(challenge.inputLabel || 'Answer')}</label>
        <input id="ctf-answer-input" name="ctf-answer" class="form-input" type="${challenge.mode === 'password' ? 'password' : 'text'}" placeholder="${this.escapeHtml(challenge.placeholder || 'Enter your answer')}" />
        <p id="ctf-answer-error" class="error-message ctf-inline-error"></p>
      </div>
      <button type="submit" id="ctf-submit-btn" class="button-link ctf-submit-link w-inline-block">
        <div class="button">
          <p class="button-label">${this.escapeHtml(challenge.actionLabel || 'Submit Answer')}</p>
          <div class="button-icon">
            <div class="button-icon-svg w-embed">
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M7.37744 0.0888672V6.43945H6.65967V1.31348L1.10303 6.86035L1.04834 6.91504L0.55127 6.41797L0.605957 6.36328L6.15186 0.806641H1.02686V0.0888672H7.37744Z" fill="currentColor" stroke-width="0.155153"></path>
              </svg>
            </div>
          </div>
        </div>
      </button>
    `;
  },

  buildCtfChallengeFormMarkup(challenge, ctf, promptMarkup, assetMarkup) {
    return `
      <form class="ctf-challenge-card ctf-challenge-card-form" autocomplete="off">
        ${this.buildCtfChallengeFormFieldsMarkup(challenge, ctf, promptMarkup, assetMarkup)}
      </form>
    `;
  },

  setupCtfFinalScrollGate() {
    this.cleanupCtfFinalScrollGate();

    const viewport = document.getElementById('ctf-final-scrollgate-viewport');
    const shell = viewport?.closest('.ctf-final-reveal-shell');
    const stage = viewport?.querySelector('.ctf-final-scrollgate-stage');
    const tube = viewport?.querySelector('.ctf-final-scrollgate-tube');
    const tubeInner = viewport?.querySelector('.ctf-final-scrollgate-tube-inner');
    const seedLine = tubeInner?.querySelector('.ctf-final-scrollgate-line');
    const question = document.getElementById('ctf-final-question');

    if (!viewport || !shell || !stage || !tube || !tubeInner || !seedLine || !question || typeof window.gsap === 'undefined') {
      return;
    }

    const numLines = 10;
    const angle = 360 / numLines;
    const gsap = window.gsap;
    const expoOut = gsap.parseEase('expo.out');
    let revealed = false;
    let radius = 0;
    let origin = '50% 50% -120px';
    let rafId = 0;
    let targetProgress = 0;
    let renderProgress = 0;
    let requiredWheelDistance = 9600;

    while (tubeInner.children.length < numLines) {
      const clone = seedLine.cloneNode(true);
      tubeInner.appendChild(clone);
    }

    const lines = Array.from(tubeInner.querySelectorAll('.ctf-final-scrollgate-line'));
    const set3D = () => {
      const width = Math.max(viewport.clientWidth, 280);
      const height = Math.max(viewport.clientHeight, 260);
      const fontSizePx = Math.max(54, Math.min(width * 0.17, 122));
      radius = (fontSizePx / 2) / Math.sin((180 / numLines) * (Math.PI / 180));
      origin = `50% 50% -${radius}px`;
      requiredWheelDistance = Math.max(height * 21, 9600);

      gsap.set(lines, {
        rotationX: (index) => -angle * index,
        z: radius,
        transformOrigin: origin,
      });
    };

    const renderAt = (progress) => {
      const clampedProgress = Math.min(Math.max(progress, 0), 1);
      const rotation = clampedProgress * 1080;

      lines.forEach((line, index) => {
        const degrees = rotation - angle * index;
        const radians = degrees * (Math.PI / 180);
        const conversion = Math.abs(Math.cos(radians) / 2 + 0.5);

        gsap.set(line, {
          rotationX: degrees,
          opacity: Math.min(conversion + 0.08, 1),
          fontWeight: 200 + (600 * conversion),
          fontStretch: `${100 + (700 * conversion)}%`,
        });
      });

      const depthProgress = Math.min(
        1,
        (expoOut(clampedProgress) * 0.72) + (Math.pow(clampedProgress, 0.92) * 0.28),
      );

      gsap.set(tube, {
        perspective: `${Math.max(1, 100 - (99 * depthProgress))}vw`,
        scale: 1 + (depthProgress * 0.018),
      });

      if (!revealed && progress >= 0.999) {
        revealed = true;
        this.state.ctfFinalRevealComplete = true;
        viewport.classList.add('is-revealed');
        targetProgress = 1;
        renderProgress = 1;
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        renderAt(1);

        const timeline = gsap.timeline();
        timeline.to(stage, {
          opacity: 0,
          duration: 0.78,
          scale: 1.018,
          filter: 'blur(10px)',
          ease: 'power2.out',
        });
        timeline.set(stage, { pointerEvents: 'none' }, '<');
        timeline.to(question, {
          opacity: 1,
          y: 0,
          duration: 0.94,
          ease: 'power2.out',
          onComplete: () => {
            question.classList.add('is-visible');
          },
        }, '-=0.2');
      }
    };

    const tick = () => {
      renderProgress += (targetProgress - renderProgress) * 0.12;
      renderAt(renderProgress);

      if (Math.abs(targetProgress - renderProgress) > 0.0006 && !revealed) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        rafId = 0;
        renderAt(targetProgress);
      }
    };

    const queueRender = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const setTargetProgress = (nextProgress) => {
      targetProgress = Math.min(Math.max(nextProgress, 0), 1);
      queueRender();
    };

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (revealed) {
        return;
      }

      const delta = Math.max(-240, Math.min(event.deltaY, 240));
      setTargetProgress(targetProgress + (delta / requiredWheelDistance));
    };

    const handleResize = () => {
      set3D();
      renderAt(renderProgress);
    };

    question.style.opacity = '0';
    question.style.transform = 'translateY(18px)';
    question.classList.remove('is-visible');
    viewport.classList.remove('is-revealed');
    gsap.set(stage, {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      pointerEvents: 'auto',
    });

    set3D();
    renderAt(0);

    shell.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('resize', handleResize);

    this.state.ctfFinalScrollCleanup = () => {
      shell.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  },

  setCtfLoading(isLoading) {
    const loader = document.getElementById('ctf-loading');
    const body = document.getElementById('ctf-body');

    if (loader) {
      loader.hidden = !isLoading;
    }

    if (body) {
      body.hidden = isLoading;
    }

    if (!isLoading && body && typeof window.gsap !== 'undefined') {
      window.gsap.fromTo(body, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    }
  },

  async loadCtfState() {
    try {
      this.setCtfLoading(true);
      const ctf = await this.fetchCtfState();
      this.state.ctf = ctf;
      this.state.ctfPendingAdvanceState = null;
      this.state.ctfRecentKeys = [];
      this.state.ctfKonamiBusy = false;
      this.state.ctfKonamiRetry = false;
      this.state.ctfKonamiSolved = false;
      this.renderCtf(ctf);
      await this.waitForCtfIntroLoaderGate();
      this.setCtfLoading(false);
      await this.maybeShowCtfEntryNotice();
    } catch (error) {
      console.error(error);
      if (error.status === 401) {
        this.redirect('/register');
        return;
      }
      await this.waitForCtfIntroLoaderGate();
      this.setCtfLoading(false);
      this.showFatalError(error.message || 'Unable to load the CTF right now.');
    }
  },

  renderCtf(ctf) {
    this.state.ctf = ctf;

    const playerName = document.getElementById('ctf-team-name');
    const playerLevel = document.getElementById('ctf-team-level-copy');
    const memberProgress = document.getElementById('ctf-member-progress-copy');
    const playerRank = document.getElementById('ctf-team-rank');
    const statusBanner = document.getElementById('ctf-status-banner');
    const returnLink = document.querySelector('.ctf-return-link');
    const signOutButton = document.getElementById('ctf-sign-out-btn');
    const isGuest = Boolean(ctf.viewer?.guest);

    if (ctf.locked) {
      if (playerName) {
        playerName.textContent = 'Challenge Board';
      }

      if (playerLevel) {
        playerLevel.textContent = '';
        playerLevel.hidden = true;
      }

      if (memberProgress) {
        memberProgress.textContent = 'Come back at launch to start the challenge.';
      }

      if (playerRank) {
        playerRank.textContent = 'Leaderboard opens with the CTF';
      }

      if (returnLink) {
        returnLink.href = this.state.session ? '/dashboard' : '/register';
        returnLink.textContent = this.state.session ? 'Back to Dashboard' : 'Back to Register';
      }

      if (signOutButton) {
        signOutButton.hidden = !this.state.session;
      }

      if (statusBanner) {
        statusBanner.hidden = false;
        statusBanner.classList.remove('is-success');
        statusBanner.textContent = 'The CTF opens on π day, π pm (14 March, 3:14 PM) GMT.';
      }

      this.renderCtfCompletedList(document.getElementById('ctf-completed-list'), ctf);
      this.renderCtfLeaderboard(document.getElementById('ctf-leaderboard-list'), ctf);
      this.renderCtfChallenge();
      return;
    }

    if (playerName) {
      playerName.textContent = isGuest ? 'Guest Run' : ctf.viewer.name;
    }

    if (playerLevel) {
      playerLevel.hidden = false;
      playerLevel.textContent = isGuest
        ? `Open practice run · ${ctf.challengeCount} challenges`
        : `Personal level ${ctf.member.highestSolvedChallenge} / ${this.config.ctfChallengeCount || ctf.challengeCount}`;
    }

    if (memberProgress) {
      if (ctf.member.completed) {
        memberProgress.textContent = isGuest
          ? `Guest run complete: ${ctf.member.solvedChallenges.length}/${ctf.challengeCount} challenges cleared.`
          : `Your run is complete: ${ctf.member.solvedChallenges.length}/${ctf.challengeCount} challenges cleared.`;
      } else {
        memberProgress.textContent = isGuest
          ? `Guest run is on challenge ${ctf.member.currentChallengeNumber}/${ctf.challengeCount}.`
          : `Your run is on challenge ${ctf.member.currentChallengeNumber}/${ctf.challengeCount}.`;
      }
    }

    if (playerRank) {
      if (isGuest) {
        playerRank.textContent = 'Sign in to appear';
      } else {
        const ownRow = ctf.leaderboard.find((row) => row.userId === ctf.viewer.id);
        playerRank.textContent = ownRow?.winner
          ? 'Winner'
          : ownRow
            ? `Rank #${ownRow.rank}`
            : 'Solve one challenge to rank';
      }
    }

    if (returnLink) {
      returnLink.href = this.state.session ? '/dashboard' : '/register';
      returnLink.textContent = this.state.session ? 'Back to Dashboard' : 'Back to Register';
    }

    if (signOutButton) {
      signOutButton.hidden = !this.state.session;
    }

    if (statusBanner) {
      statusBanner.hidden = false;
      if (isGuest) {
        statusBanner.classList.remove('is-success');
        statusBanner.textContent = 'Guest mode only. Your progress will not be saved.';
      } else if (ctf.completionMessage) {
        statusBanner.classList.add('is-success');
        statusBanner.textContent = ctf.completionMessage.winner
          ? 'Congratulations. You are the winner of the FamHack CTF.'
          : ctf.completionMessage.copy;
      } else {
        statusBanner.classList.remove('is-success');
        statusBanner.textContent = ctf.leaderboard.some((row) => row.winner)
          ? 'A winner is on the board. The CTF is still open for more clears.'
          : 'No winners yet. The CTF is still running.';
      }
    }

    this.renderCtfCompletedList(document.getElementById('ctf-completed-list'), ctf);
    this.renderCtfLeaderboard(document.getElementById('ctf-leaderboard-list'), ctf);
    this.renderCtfChallenge();
  },

  renderCtfCompletedList(container, ctf) {
    if (!container) {
      return;
    }

    if (ctf.locked) {
      container.innerHTML = '<p class="empty-state">No clears yet.</p>';
      return;
    }

    const solved = ctf.solvedChallenges || [];
    if (!solved.length) {
      container.innerHTML = ctf.viewer?.guest
        ? '<p class="empty-state">No clears yet. This guest run starts from challenge one.</p>'
        : '<p class="empty-state">No personal clears yet. Your first solve starts the run.</p>';
      return;
    }

    container.innerHTML = solved.map((challenge) => `
      <div class="ctf-completed-chip">
        <span class="ctf-completed-number">0${challenge.number}</span>
        <span class="ctf-completed-title">${this.escapeHtml(challenge.title)}</span>
      </div>
    `).join('');
  },

  renderCtfLeaderboard(container, ctf) {
    if (!container) {
      return;
    }

    if (ctf.locked) {
      container.innerHTML = '<p class="empty-state">No clears yet.</p>';
      return;
    }

    if (!ctf.leaderboard.length) {
      container.innerHTML = '<p class="empty-state">No clears yet.</p>';
      return;
    }

    const visibleRows = ctf.leaderboard.slice(0, this.config.ctfLeaderboardVisibleCount);

    container.innerHTML = visibleRows.map((row) => {
      const isCurrentPlayer = !ctf.viewer?.guest && row.userId === ctf.viewer.id;
      const stamp = row.reachedAt ? this.formatDateTime(row.reachedAt) : 'Waiting for first clear';
      const levelMarkup = row.winner
        ? `
          <div class="ctf-leaderboard-level is-trophy" aria-label="Winner">
            ${this.renderCtfWinnerIcon()}
          </div>
        `
        : `<div class="ctf-leaderboard-level">L${row.level}</div>`;

      return `
        <div class="ctf-leaderboard-row${isCurrentPlayer ? ' is-current-team' : ''}">
          <div class="ctf-leaderboard-rank">#${row.rank}</div>
          <div class="ctf-leaderboard-team">
            <p class="ctf-leaderboard-name">${this.escapeHtml(row.name)}</p>
            <p class="ctf-leaderboard-meta">${stamp}</p>
          </div>
          ${levelMarkup}
        </div>
      `;
    }).join('');
  },

  renderCtfWinnerIcon() {
    return `
      <span class="ctf-winner-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
          <path d="M12 8h16v5c0 4.9-3.2 8.9-8 10-4.8-1.1-8-5.1-8-10V8Z" fill="currentColor"/>
          <path d="M16 25h8v4h4v3H12v-3h4v-4Z" fill="currentColor"/>
          <path d="M12 10H7c0 5 1.7 7.8 5.9 9.1M28 10h5c0 5-1.7 7.8-5.9 9.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </span>
    `;
  },

  renderCtfChallenge() {
    const shell = document.getElementById('ctf-challenge-shell');
    if (!shell) {
      return;
    }

    this.cleanupCtfFinalScrollGate();

    const ctf = this.state.ctf;
    if (!ctf) {
      shell.innerHTML = '';
      return;
    }

    if (ctf.locked) {
      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-locked">
          <p class="ctf-step-kicker">Opens Soon</p>
          <h2 class="ctf-challenge-title">The CTF is not live yet.</h2>
          <p class="ctf-challenge-copy">Challenge one opens at launch.</p>
        </section>
      `;
      return;
    }

    if (ctf.member.completed) {
      this.state.ctfFinalChallengeEligible = false;
      this.state.ctfFinalRevealComplete = false;
      this.closeCtfFinalInfoModal({ silent: true });
      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-success">
          <p class="ctf-step-kicker">Run Complete</p>
          <h2 class="ctf-challenge-title">${this.escapeHtml(ctf.completionMessage?.title || 'Every signal is clear.')}</h2>
          <p class="ctf-challenge-copy">${this.escapeHtml(ctf.completionMessage?.copy || 'You finished the full FamHack CTF.')}</p>
          <div class="ctf-completion-actions">
            <button type="button" class="copy-btn ctf-sigint-trigger" data-ctf-sigint-open>Interested in more?</button>
          </div>
        </section>
      `;
      return;
    }

    this.closeCtfSigintModal({ silent: true });

    const gate = this.state.ctfPendingAdvanceState;
    if (gate) {
      this.state.ctfFinalChallengeEligible = false;
      this.state.ctfFinalRevealComplete = false;
      this.closeCtfFinalInfoModal({ silent: true });
      if (gate.mode === 'konami') {
        shell.innerHTML = `
          <section class="ctf-challenge-card ctf-challenge-card-konami">
            <div class="ctf-konami-stage" aria-label="Konami unlocked">
              <p class="ctf-konami-text is-solved">${this.escapeHtml(gate.successTitle)}</p>
            </div>
            <div class="ctf-gate-actions">
              ${gate.ready
                ? '<button type="button" class="copy-btn ctf-next-btn" data-ctf-next>Next Challenge</button>'
                : '<p class="ctf-gate-pulse">Unlocking the next signal...</p>'}
            </div>
          </section>
        `;
        return;
      }

      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-success">
          <p class="ctf-step-kicker">Challenge ${gate.solvedChallengeNumber} cleared</p>
          <h2 class="ctf-challenge-title">${this.escapeHtml(gate.successTitle)}</h2>
          <p class="ctf-challenge-copy">${this.escapeHtml(gate.successCopy)}</p>
          <div class="ctf-gate-actions">
            ${gate.ready
              ? '<button type="button" class="copy-btn ctf-next-btn" data-ctf-next>Next Challenge</button>'
              : '<p class="ctf-gate-pulse">Unlocking the next signal...</p>'}
          </div>
        </section>
      `;
      return;
    }

    const challenge = ctf.currentChallenge;
    if (!challenge) {
      shell.innerHTML = '';
      return;
    }

    const assetMarkup = challenge.assetUrl
      ? `
        <a class="button-link w-inline-block ctf-download-link" href="${this.escapeHtml(challenge.assetUrl)}" download>
          <div class="button">
            <p class="button-label">${this.escapeHtml(challenge.assetLabel || 'Download clue')}</p>
            <div class="button-icon">
              <div class="button-icon-svg w-embed">
                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M7.37744 0.0888672V6.43945H6.65967V1.31348L1.10303 6.86035L1.04834 6.91504L0.55127 6.41797L0.605957 6.36328L6.15186 0.806641H1.02686V0.0888672H7.37744Z" fill="currentColor" stroke-width="0.155153"></path>
                </svg>
              </div>
            </div>
          </div>
        </a>
      `
      : '';
    const promptMarkup = challenge.prompt
      ? `<p class="ctf-challenge-copy">${this.escapeHtml(challenge.prompt)}</p>`
      : '';
    const isFinalChallenge = challenge.number === ctf.challengeCount;

    if (challenge.mode === 'konami') {
      this.state.ctfFinalChallengeEligible = false;
      this.state.ctfFinalRevealComplete = false;
      this.closeCtfFinalInfoModal({ silent: true });
      const konamiClass = this.state.ctfKonamiSolved ? ' is-solved' : '';
      const konamiText = this.state.ctfKonamiSolved ? 'Konami noticed.' : challenge.prompt;

      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-konami">
          <div class="ctf-konami-stage" aria-label="Konami challenge">
            <p id="ctf-konami-text" class="ctf-konami-text${konamiClass}">${this.escapeHtml(konamiText)}</p>
          </div>
          <p id="ctf-answer-error" class="error-message ctf-inline-error"></p>
        </section>
      `;
      return;
    }

    if (!isFinalChallenge) {
      this.state.ctfFinalChallengeEligible = false;
      this.state.ctfFinalRevealComplete = false;
      this.closeCtfFinalInfoModal({ silent: true });
    }

    const challengeFormMarkup = this.buildCtfChallengeFormMarkup(challenge, ctf, promptMarkup, assetMarkup);
    const challengeFieldsMarkup = this.buildCtfChallengeFormFieldsMarkup(challenge, ctf, promptMarkup, assetMarkup);

    if (isFinalChallenge && this.state.ctfFinalChallengeEligible && !this.state.ctfFinalRevealComplete) {
      shell.innerHTML = `
        <form class="ctf-challenge-card ctf-challenge-card-form ctf-final-reveal-shell" autocomplete="off">
          <div class="ctf-final-scrollgate" id="ctf-final-scrollgate-viewport">
            <div class="ctf-final-scrollgate-stage">
              <div class="ctf-final-scrollgate-tube">
                <div class="ctf-final-scrollgate-tube-inner">
                  <h1 class="ctf-final-scrollgate-line">Signal Six</h1>
                </div>
              </div>
            </div>
          </div>
          <div id="ctf-final-question" class="ctf-final-question">
            ${challengeFieldsMarkup}
          </div>
        </form>
      `;
      this.setupCtfFinalScrollGate();
      return;
    }

    shell.innerHTML = challengeFormMarkup;

    if (isFinalChallenge && !this.state.ctfFinalChallengeEligible) {
      window.setTimeout(() => this.openCtfFinalInfoModal(), 0);
    }
  },

  setCtfAdvanceGate(gate) {
    clearTimeout(this.state.ctfAdvanceTimer);

    this.state.ctfPendingAdvanceState = {
      ...gate,
      ready: gate.delayMs === 0 ? true : Boolean(gate.ready),
    };

    if (gate.delayMs > 0) {
      this.state.ctfAdvanceTimer = window.setTimeout(() => {
        if (!this.state.ctfPendingAdvanceState) {
          return;
        }

        this.state.ctfPendingAdvanceState.ready = true;
        this.renderCtfChallenge();
      }, gate.delayMs);
    }
  },

  async submitCtfChallenge(challenge, answer) {
    const nextState = await this.apiRequest('/api/ctf/submit', {
      method: 'POST',
      body: {
        challengeNumber: challenge.number,
        answer,
        accessToken: challenge.accessToken,
      },
    });

    this.state.ctf = nextState;
    this.state.ctfRecentKeys = [];
    this.state.ctfKonamiBusy = false;
    this.state.ctfKonamiRetry = false;

    if (nextState.member.completed) {
      this.state.ctfPendingAdvanceState = null;
      this.state.ctfKonamiSolved = false;
      this.renderCtf(nextState);
      return;
    }

    if (nextState.clearGate) {
      this.setCtfAdvanceGate(nextState.clearGate);
    } else {
      this.state.ctfPendingAdvanceState = null;
    }

    this.renderCtf(nextState);
  },

  async handleCtfSubmit(event) {
    const form = event.target.closest('form');
    if (!form || form.matches('[data-ctf-prize-claim-form]')) {
      return;
    }

    event.preventDefault();

    const ctf = this.state.ctf;
    const challenge = ctf?.currentChallenge;
    if (!challenge || challenge.mode === 'konami') {
      return;
    }

    if (challenge.number === ctf.challengeCount && ctf.viewer?.guest) {
      this.showFieldError('ctf-answer-error', 'Sign in to submit the final challenge.');
      return;
    }

    if (challenge.number === ctf.challengeCount && !this.state.ctfFinalChallengeEligible) {
      this.openCtfFinalInfoModal();
      this.showFieldError('ctf-answer-error', 'Confirm your year before continuing.');
      return;
    }

    if (challenge.number === ctf.challengeCount && !this.state.ctfFinalRevealComplete) {
      this.showFieldError('ctf-answer-error', 'Reveal the signal before continuing.');
      return;
    }

    const input = form.querySelector('#ctf-answer-input');
    const submitButton = form.querySelector('#ctf-submit-btn');
    const answer = String(input?.value || '').trim();

    this.showFieldError('ctf-answer-error', '');

    if (!answer) {
      this.showFieldError('ctf-answer-error', 'Enter an answer before submitting.');
      input?.focus();
      return;
    }

    this.setButtonState(submitButton, {
      busy: true,
      label: 'Checking...',
      idleLabel: challenge.actionLabel || 'Submit Answer',
    });

    try {
      await this.submitCtfChallenge(challenge, answer);
    } catch (error) {
      console.error(error);
      this.showFieldError('ctf-answer-error', error.message || 'That answer is not correct yet.');
    } finally {
      this.setButtonState(submitButton, {
        busy: false,
        label: 'Checking...',
        idleLabel: challenge.actionLabel || 'Submit Answer',
      });
    }
  },

  async handleCtfPrizeClaim(event) {
    const form = event.target.closest('[data-ctf-prize-claim-form]');
    if (!form) {
      return;
    }

    event.preventDefault();

    const select = form.querySelector('#ctf-prize-study-year');
    const submitButton = form.querySelector('[data-ctf-prize-claim-submit]');
    const studyYear = String(select?.value || '').trim().toLowerCase();

    this.showFieldError('ctf-prize-claim-error', '');

    if (!studyYear) {
      this.showFieldError('ctf-prize-claim-error', 'Choose your year of study.');
      select?.focus();
      return;
    }

    this.setButtonState(submitButton, {
      busy: true,
      label: 'Saving...',
      idleLabel: submitButton?.textContent || 'Save Year',
    });

    try {
      await this.apiRequest('/api/ctf/submit', {
        method: 'POST',
        body: {
          action: 'prize-claim',
          studyYear,
        },
      });
      const refreshedCtf = await this.fetchCtfState();
      this.renderCtf(refreshedCtf);
    } catch (error) {
      console.error(error);
      this.showFieldError('ctf-prize-claim-error', error.message || 'Unable to save prize eligibility right now.');
    } finally {
      this.setButtonState(submitButton, {
        busy: false,
        label: 'Saving...',
        idleLabel: submitButton?.textContent || 'Save Year',
      });
    }
  },

  async handleKonamiKeydown(event) {
    if (this.state.page !== 'ctf' || !this.state.ctf || this.state.ctfPendingAdvanceState) {
      return;
    }

    const challenge = this.state.ctf.currentChallenge;
    if (!challenge || challenge.number !== 2 || challenge.mode !== 'konami' || this.state.ctfKonamiSolved) {
      return;
    }

    const key = this.normalizeKonamiKey(event.key);
    if (!key) {
      return;
    }

    this.state.ctfRecentKeys.push(key);
    if (this.state.ctfRecentKeys.length > 20) {
      this.state.ctfRecentKeys = this.state.ctfRecentKeys.slice(-20);
    }

    await this.processKonamiKeyBuffer(challenge);
  },

  advanceSolvedCtfChallenge() {
    clearTimeout(this.state.ctfAdvanceTimer);
    this.state.ctfAdvanceTimer = null;
    this.state.ctfPendingAdvanceState = null;
    this.state.ctfRecentKeys = [];
    this.state.ctfKonamiBusy = false;
    this.state.ctfKonamiRetry = false;
    this.state.ctfKonamiSolved = false;
    if (this.state.ctf?.clearGate) {
      delete this.state.ctf.clearGate;
    }
    this.renderCtf(this.state.ctf);
  },

  normalizeKonamiKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const ignoredKeys = new Set([
      'shift',
      'control',
      'alt',
      'meta',
      'capslock',
      'tab',
      'escape',
      'enter',
      'backspace',
    ]);

    if (ignoredKeys.has(normalized)) {
      return null;
    }

    return normalized;
  },

  async decryptKonamiBundle(bundle, password) {
    if (!bundle || !password || !window.crypto?.subtle) {
      return null;
    }

    try {
      const encoder = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey'],
      );
      const saltBytes = Uint8Array.from(atob(bundle.salt), (char) => char.charCodeAt(0));
      const encryptedBytes = Uint8Array.from(atob(bundle.encrypted), (char) => char.charCodeAt(0));
      const iv = encryptedBytes.slice(0, 12);
      const ciphertext = encryptedBytes.slice(12);
      const key = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: Number(bundle.iterations) || 6000,
          hash: bundle.hash || 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      );
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );

      return JSON.parse(new TextDecoder().decode(decryptedBuffer));
    } catch (error) {
      return null;
    }
  },

  async processKonamiKeyBuffer(challenge) {
    if (this.state.ctfKonamiBusy) {
      this.state.ctfKonamiRetry = true;
      return;
    }

    this.state.ctfKonamiBusy = true;

    try {
      do {
        this.state.ctfKonamiRetry = false;

        const bundle = challenge.konamiBundle;
        const keyBuffer = [...this.state.ctfRecentKeys];
        const maxWindow = Math.min(20, keyBuffer.length);
        let decrypted = null;

        for (let length = 1; length <= maxWindow; length += 1) {
          const candidate = keyBuffer.slice(-length).join('');
          decrypted = await this.decryptKonamiBundle(bundle, candidate);
          if (decrypted?.proof) {
            break;
          }
        }

        if (!decrypted?.proof || this.state.ctfKonamiSolved) {
          continue;
        }

        this.state.ctfKonamiSolved = true;
        this.renderCtfChallenge();
        await this.submitCtfChallenge(challenge, decrypted.proof);
        return;
      } while (this.state.ctfKonamiRetry && !this.state.ctfKonamiSolved);
    } catch (error) {
      console.error(error);
      this.state.ctfKonamiSolved = false;
      this.renderCtfChallenge();
      this.showFieldError('ctf-answer-error', error.message || 'That sequence did not unlock the next signal.');
    } finally {
      this.state.ctfKonamiBusy = false;
    }
  },

  async fetchDashboard({ suppressMissing } = {}) {
    try {
      return await this.apiRequest('/api/team/dashboard');
    } catch (error) {
      if (suppressMissing && (error.status === 404 || error.status === 401 || error.status === 403)) {
        return null;
      }
      throw error;
    }
  },

  async loadDashboard() {
    try {
      this.setDashboardLoading(true);
      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (!dashboard) {
        const status = await this.fetchRegistrationStatus({ suppressMissing: true });
        const registration = status?.registration || null;

        if (!registration?.role) {
          this.redirect('/register');
          return;
        }

        this.renderDashboardOnboarding(registration, status);
        this.setDashboardLoading(false);
        return;
      }

      this.renderDashboard(dashboard);
      this.setDashboardLoading(false);
    } catch (error) {
      console.error(error);
      this.setDashboardLoading(false);
      this.showFatalError(error.message || 'Unable to load your dashboard right now.');
    }
  },

  renderDashboard(dashboard) {
    this.state.dashboard = dashboard;
    const isLeadParent = dashboard.viewer.role === 'parent'
      && dashboard.viewer.status === 'approved'
      && dashboard.viewer.id === dashboard.team.ownerId;
    const canDeleteFamily = isLeadParent
      && dashboard.members.length === 1
      && dashboard.pendingRequests.length === 0;
    const canCancelPending = dashboard.viewer.status === 'pending';
    const canLeaveFamily = dashboard.viewer.status === 'approved' && !isLeadParent;
    const capacityCopy = document.getElementById('dashboard-capacity-copy');
    const teamName = document.getElementById('dashboard-team-name');
    const joinCodeDisplay = document.getElementById('join-code-display');
    const inviteLinkInput = document.getElementById('invite-link-input');
    const inviteGrid = document.getElementById('invite-grid');
    const inviteLinkCopy = document.getElementById('invite-link-copy');
    const inviteLinkLabel = document.getElementById('invite-link-label');
    const dangerSection = document.getElementById('danger-section');
    const dangerToggleWrap = document.getElementById('danger-toggle-wrap');
    const dangerToggleButton = document.getElementById('danger-toggle-btn');
    const dangerPanel = document.getElementById('danger-panel');
    const dangerCopy = document.getElementById('danger-copy');
    const deleteTeamConfirmGroup = document.getElementById('delete-team-confirm-group');
    const deleteTeamConfirmInput = document.getElementById('delete-team-confirm-input');
    const deleteTeamConfirmHint = document.getElementById('delete-team-confirm-hint');
    const leaveTeamButton = document.getElementById('leave-team-btn');
    const ctfLaunchTitle = document.getElementById('ctf-launch-title');
    const ctfLaunchCopy = document.getElementById('ctf-launch-copy');
    const ctfLaunchLink = document.getElementById('ctf-launch-link');
    const statusBanner = document.getElementById('dashboard-status-banner');
    const pendingSection = document.getElementById('pending-section');
    const pendingList = document.getElementById('pending-list');
    const poolSection = document.getElementById('pool-section');
    const poolList = document.getElementById('pool-list');
    const membersList = document.getElementById('members-list');
    const onboardingShell = document.getElementById('dashboard-onboarding-shell');
    const membersShell = document.getElementById('dashboard-members-shell');
    const roadmap = document.getElementById('dashboard-roadmap');

    if (onboardingShell) {
      onboardingShell.hidden = true;
    }

    if (membersShell) {
      membersShell.hidden = false;
    }

    if (roadmap) {
      roadmap.hidden = false;
    }

    if (teamName) {
      teamName.dataset.heading = dashboard.team.name;
      teamName.textContent = dashboard.team.name;
    }

    if (capacityCopy) {
      capacityCopy.textContent = `${dashboard.team.approvedCount} / ${dashboard.team.maxMembers} approved members`;
    }

    if (leaveTeamButton) {
      leaveTeamButton.hidden = true;
    }

    if (dangerSection && dangerCopy && deleteTeamConfirmGroup && leaveTeamButton && dangerToggleWrap && dangerToggleButton && dangerPanel) {
      dangerSection.hidden = true;
      dangerSection.classList.remove('is-expanded');
      dangerToggleWrap.hidden = true;
      dangerToggleButton.hidden = true;
      deleteTeamConfirmGroup.hidden = true;
      this.showFieldError('delete-team-confirm-error', '');

      if (deleteTeamConfirmInput) {
        deleteTeamConfirmInput.value = '';
      }

      if (canCancelPending || canLeaveFamily) {
        dangerSection.hidden = false;
        dangerPanel.hidden = false;
        leaveTeamButton.hidden = false;
        leaveTeamButton.textContent = canCancelPending ? 'Cancel Request' : 'Leave Family';
        dangerCopy.textContent = canCancelPending
          ? 'Cancel this join request if you selected the wrong family.'
          : 'Leave this family. You will need a new family code or invite link to join again.';
        this.setDangerPanelOpen(true, { instant: true });
      } else if (canDeleteFamily) {
        dangerSection.hidden = false;
        dangerToggleWrap.hidden = false;
        dangerToggleButton.hidden = false;
        leaveTeamButton.hidden = false;
        leaveTeamButton.textContent = 'Delete Family';
        deleteTeamConfirmGroup.hidden = false;
        dangerCopy.textContent = 'You are the only active member in this family. Deleting it will permanently remove the family and its join code.';
        if (deleteTeamConfirmHint) {
          deleteTeamConfirmHint.textContent = `Type "${dashboard.team.name}" exactly to confirm deletion.`;
        }
        this.setDangerPanelOpen(false, { instant: true });
      }
    }

    if (joinCodeDisplay) {
      joinCodeDisplay.value = dashboard.team.joinCode;
    }

    if (inviteLinkInput) {
      inviteLinkInput.value = `${window.location.origin}/join?code=${encodeURIComponent(dashboard.team.joinCode)}&familyInvite=1`;
    }

    if (inviteLinkLabel) {
      inviteLinkLabel.textContent = 'Child Letter Link';
    }

    if (inviteLinkCopy) {
      inviteLinkCopy.textContent = dashboard.team.kind === 'volunteer'
        ? 'This opens a letter that invites a child to join your volunteer family.'
        : 'This opens a letter that tells your child you invited them to FamHack.';
    }

    if (inviteGrid) {
      inviteGrid.hidden = !(dashboard.viewer.role === 'parent' && dashboard.viewer.status === 'approved' && dashboard.team.kind !== 'volunteer');
    }

    if (ctfLaunchTitle && ctfLaunchCopy && ctfLaunchLink) {
      ctfLaunchTitle.textContent = 'Take on the CTF';
      ctfLaunchCopy.textContent = 'First to clear all challenges wins £20 and a certificate.';
      ctfLaunchLink.href = '/ctf';
      ctfLaunchLink.removeAttribute('aria-disabled');
      ctfLaunchLink.classList.remove('is-disabled');
      this.setButtonLabel(ctfLaunchLink, 'Open CTF');
    }

    if (statusBanner) {
      if (dashboard.viewer.status === 'pending') {
        statusBanner.hidden = false;
        statusBanner.textContent = 'Your join request is pending parent approval.';
      } else if (dashboard.team.isFull) {
        statusBanner.hidden = false;
        statusBanner.textContent = `This family is full at ${dashboard.team.approvedCount}/${dashboard.team.maxMembers}. Pending requests can be declined, but no further approvals can go through until someone leaves.`;
      } else {
        statusBanner.hidden = !(dashboard.viewer.role === 'parent' && dashboard.viewer.status === 'approved');
        statusBanner.textContent = dashboard.team.kind === 'volunteer'
          ? 'Volunteer families are saved for later FamHack assignment.'
          : 'Share the family code, child letter link, or email invite below.';
      }
    }

    this.renderDashboardRoadmap(dashboard);
    this.renderApprovedMembers(membersList, dashboard.members, dashboard);

    if (dashboard.viewer.role === 'parent' && dashboard.viewer.status === 'approved') {
      if (dashboard.team.kind === 'volunteer') {
        if (pendingSection) {
          pendingSection.hidden = true;
        }
        if (poolSection) {
          poolSection.hidden = false;
          this.renderChildPool(poolList, dashboard.childPool || [], dashboard);
        }
      } else {
        if (pendingSection) {
          pendingSection.hidden = false;
          this.renderPendingMembers(pendingList, dashboard.pendingRequests, dashboard);
        }
        if (poolSection) {
          poolSection.hidden = true;
        }
      }
    } else {
      if (pendingSection) {
        pendingSection.hidden = true;
      }
      if (poolSection) {
        poolSection.hidden = true;
      }
    }
  },

  renderChildOnboardingState(status = null) {
    const childOnboardingHeading = document.getElementById('dashboard-child-onboarding-heading');
    const childOnboardingCopy = document.getElementById('dashboard-child-onboarding-copy');
    const childOnboardingStatus = document.getElementById('dashboard-child-onboarding-status');
    const childOnboardingLink = document.getElementById('dashboard-child-onboarding-link');
    const trackCard = document.getElementById('dashboard-child-track-card');
    const trackTitle = document.getElementById('dashboard-child-track-title');
    const trackHelper = document.getElementById('dashboard-child-track-helper');
    const routeCard = document.getElementById('dashboard-child-route-card');
    const routeTitle = document.getElementById('dashboard-child-route-title');
    const routeHelper = document.getElementById('dashboard-child-route-helper');
    const activeRoute = this.getActiveChildRoute(status);
    const profile = status?.profile || null;
    const routeSource = activeRoute === 'pool'
      ? status?.childPoolEntry
      : activeRoute === 'invite'
        ? status?.parentInvite
        : null;
    const trackLabel = routeSource?.childFocusLabel || profile?.childFocusLabel || '';
    const trackDescription = routeSource?.childFocusDescription || profile?.childFocusDescription || '';
    let heading = 'Join FamHack';
    let copy = trackLabel
      ? 'Track selected.'
      : 'Choose your track.';
    let statusCopy = '';
    let linkHref = '/join';
    let linkLabel = trackLabel ? 'Finish Join Setup' : 'Choose My Path';
    let routeTitleText = '';
    let routeHelperText = '';

    if (trackCard && trackTitle && trackHelper) {
      trackCard.hidden = !trackLabel;
      trackTitle.textContent = trackLabel;
      trackHelper.textContent = trackDescription || '';
    }

    if (activeRoute === 'pool') {
      heading = 'Random Family Pool';
      copy = 'You are in the random-family pool.';
      statusCopy = 'Assignment pending.';
      linkHref = '/join';
      linkLabel = 'Change My Preferences';
      routeTitleText = 'Random Family Pool';
      routeHelperText = 'FamHack will assign you later.';
    } else if (activeRoute === 'invite') {
      const parentEmail = status?.parentInvite?.parentEmail || '';
      heading = 'Parent Invite Sent';
      copy = parentEmail
        ? `Invite sent to ${parentEmail}.`
        : 'Parent invite sent.';
      statusCopy = parentEmail
        ? `Waiting for ${parentEmail}.`
        : 'Waiting for your parent.';
      linkHref = '/join';
      linkLabel = 'Change My Preferences';
      routeTitleText = 'Parent Invite';
      routeHelperText = parentEmail
        ? parentEmail
        : 'You will be added when they register.';
    }

    if (childOnboardingHeading) {
      childOnboardingHeading.textContent = heading;
    }

    if (childOnboardingCopy) {
      childOnboardingCopy.textContent = copy;
    }

    if (routeCard && routeTitle && routeHelper) {
      routeCard.hidden = !routeTitleText;
      routeTitle.textContent = routeTitleText;
      routeHelper.textContent = routeHelperText;
    }

    if (childOnboardingStatus) {
      childOnboardingStatus.hidden = !statusCopy;
      childOnboardingStatus.textContent = statusCopy;
    }

    if (childOnboardingLink) {
      childOnboardingLink.href = linkHref;
      this.setButtonLabel(childOnboardingLink, linkLabel);
    }
  },

  renderDashboardOnboarding(registration, status = null) {
    this.state.dashboard = null;

    const teamName = document.getElementById('dashboard-team-name');
    const capacityCopy = document.getElementById('dashboard-capacity-copy');
    const statusBanner = document.getElementById('dashboard-status-banner');
    const onboardingShell = document.getElementById('dashboard-onboarding-shell');
    const membersShell = document.getElementById('dashboard-members-shell');
    const parentOnboarding = document.getElementById('dashboard-parent-onboarding');
    const childOnboarding = document.getElementById('dashboard-child-onboarding');
    const parentOnboardingCopy = document.getElementById('dashboard-parent-onboarding-copy');
    const roadmap = document.getElementById('dashboard-roadmap');

    this.state.registrationStatus = status || this.state.registrationStatus;

    if (teamName) {
      teamName.dataset.heading = 'Family Dashboard';
      teamName.textContent = 'Family Dashboard';
    }

    if (capacityCopy) {
      capacityCopy.textContent = registration.role === 'parent'
        ? 'Create your family to unlock join codes, invite links, and approvals.'
        : 'Join a family to unlock your member dashboard.';
    }

    if (statusBanner) {
      statusBanner.hidden = true;
      statusBanner.textContent = '';
    }

    if (onboardingShell) {
      onboardingShell.hidden = false;
    }

    if (membersShell) {
      membersShell.hidden = true;
    }

    if (roadmap) {
      roadmap.hidden = true;
    }

    if (parentOnboarding) {
      parentOnboarding.hidden = registration.role !== 'parent';
    }

    if (childOnboarding) {
      childOnboarding.hidden = registration.role !== 'child';
    }

    if (parentOnboardingCopy) {
      parentOnboardingCopy.textContent = this.state.parentInviteToken
        ? 'A child invited you to register this family. Create it here and FamHack will add them automatically.'
        : 'You are registered as a Parent. Choose whether you are registering your own family or volunteering to parent children who need one.';
    }

    this.setParentTeamKind(this.state.parentInviteToken ? 'family' : this.getParentTeamKind());

    document.querySelectorAll('[data-parent-team-kind-card]').forEach((card) => {
      const isVolunteer = card.dataset.parentTeamKindCard === 'volunteer';
      if (this.state.parentInviteToken && isVolunteer) {
        card.classList.add('is-disabled');
        card.setAttribute('aria-disabled', 'true');
      } else {
        card.classList.remove('is-disabled');
        card.removeAttribute('aria-disabled');
      }
    });

    this.renderChildOnboardingState(status);
  },

  renderDashboardRoadmap(dashboard) {
    const roadmapList = document.getElementById('dashboard-roadmap-list');
    if (!roadmapList) {
      return;
    }

    const items = dashboard.viewer.status === 'pending'
      ? [
          {
            step: 'Step 1',
            title: 'Wait for approval',
            copy: 'A parent in this family needs to approve your request before you can compete together.',
          },
          {
            step: 'Step 2',
            title: 'Check this dashboard',
            copy: 'This page updates automatically once your request is approved or declined.',
          },
          {
            step: 'Step 3',
            title: 'Start the CTF',
            copy: 'Once approved, your family can jump straight into the challenge.',
          },
        ]
      : dashboard.viewer.role === 'parent'
        ? dashboard.team.kind === 'volunteer'
          ? [
              {
                step: 'Step 1',
                title: 'Wait for assignments',
                copy: 'Volunteer families stay ready for FamHack to match children into them later.',
              },
              {
                step: 'Step 2',
                title: 'Review the pool',
                copy: 'Use the random-family pool section below when children are available.',
              },
              {
                step: 'Step 3',
                title: 'Open the CTF',
                copy: 'Once your family is set, move straight into the challenge together.',
              },
            ]
          : [
              {
                step: 'Step 1',
                title: 'Invite your family',
                copy: 'Share the family code, child letter link, or ready-to-send email below.',
              },
              {
                step: 'Step 2',
                title: 'Approve requests',
                copy: 'Keep an eye on the approval queue and confirm new members as they arrive.',
              },
              {
                step: 'Step 3',
                title: 'Open the CTF',
                copy: 'Once your family is ready, jump into the challenge together.',
              },
            ]
        : [
            {
              step: 'Step 1',
              title: 'Family confirmed',
              copy: 'Your membership is active and the live family details are listed below.',
            },
            {
              step: 'Step 2',
              title: 'Stay synced',
              copy: 'Parents can still invite or approve more members using the same family code.',
            },
            {
              step: 'Step 3',
              title: 'Open the CTF',
              copy: 'You are ready to start the challenge from this dashboard.',
            },
          ];

    roadmapList.innerHTML = items.map((item) => `
      <article class="dashboard-roadmap-card">
        <p class="dashboard-roadmap-step">${this.escapeHtml(item.step)}</p>
        <h3 class="dashboard-roadmap-title">${this.escapeHtml(item.title)}</h3>
        <p class="dashboard-roadmap-copy">${this.escapeHtml(item.copy)}</p>
      </article>
    `).join('');
  },

  renderApprovedMembers(container, members, dashboard) {
    if (!container) return;

    container.innerHTML = '';
    if (!members.length) {
      container.innerHTML = '<p class="empty-state">No approved family members yet.</p>';
      return;
    }

    members.forEach((member) => {
      container.insertAdjacentHTML('beforeend', this.memberCardTemplate(member, { dashboard }));
    });

    container.querySelectorAll('[data-transfer-parent]').forEach((button) => {
      button.addEventListener('click', async () => {
        const membershipId = button.dataset.transferParent;
        await this.handleTransferParent(button, membershipId);
      });
    });

    container.querySelectorAll('[data-make-parent]').forEach((button) => {
      button.addEventListener('click', async () => {
        const membershipId = button.dataset.makeParent;
        await this.handleMakeParent(button, membershipId);
      });
    });
  },

  renderPendingMembers(container, members, dashboard) {
    if (!container) return;

    container.innerHTML = '';
    if (!members.length) {
      container.innerHTML = '<p class="empty-state">No pending requests right now.</p>';
      return;
    }

    members.forEach((member) => {
      container.insertAdjacentHTML('beforeend', this.memberCardTemplate(member, { reviewable: true, dashboard }));
    });

    container.querySelectorAll('[data-review-membership]').forEach((button) => {
      button.addEventListener('click', async () => {
        const membershipId = button.dataset.reviewMembership;
        const decision = button.dataset.reviewDecision;
        await this.reviewRequest(button, membershipId, decision);
      });
    });
  },

  renderChildPool(container, entries, dashboard) {
    if (!container) return;

    container.innerHTML = '';
    if (!entries.length) {
      container.innerHTML = '<p class="empty-state">No children are waiting for a volunteer family right now.</p>';
      return;
    }

    entries.forEach((entry) => {
      const displayName = this.escapeHtml(entry.fullName || entry.email || 'Unknown child');
      const email = this.escapeHtml(entry.email || '');
      const parts = [entry.childFocusLabel, entry.childFocusDescription, entry.studyYearLabel].filter(Boolean);
      const meta = this.escapeHtml(parts.join(' · '));
      const addDisabled = Boolean(dashboard?.team?.isFull);
      const buttonLabel = addDisabled ? 'Family Full' : 'Add to Family';

      container.insertAdjacentHTML('beforeend', `
        <div class="member-card">
          <div class="member-info">
            <p class="member-name">${displayName}</p>
            <p class="member-email">${email}</p>
            <p class="member-meta">${meta}</p>
          </div>
          <div class="member-card-actions">
            <button class="action-btn action-approve" data-pool-add="${entry.id}" ${addDisabled ? 'disabled' : ''}>${buttonLabel}</button>
          </div>
        </div>
      `);
    });

    container.querySelectorAll('[data-pool-add]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.handleAddPoolChild(button, button.dataset.poolAdd);
      });
    });
  },

  memberCardTemplate(member, options = {}) {
    const dashboard = options.dashboard || this.state.dashboard;
    const displayName = this.escapeHtml(member.fullName || member.email || 'Unknown member');
    const email = this.escapeHtml(member.email || '');
    const isPrimaryParent = dashboard?.team?.ownerId && member.userId === dashboard.team.ownerId && member.role === 'parent';
    const roleLabel = this.formatDashboardRole(member.role, { primary: isPrimaryParent });
    const statusLabel = member.status.charAt(0).toUpperCase() + member.status.slice(1);
    const studyYearLabel = this.escapeHtml(member.studyYearLabel || '');
    const childFocusLabel = this.escapeHtml(member.childFocusLabel || '');
    const memberMetaParts = [roleLabel, studyYearLabel, childFocusLabel].filter(Boolean);
    const memberMeta = memberMetaParts.join(' · ');
    const canPromoteParent = dashboard?.viewer?.role === 'parent'
      && dashboard?.viewer?.status === 'approved'
      && member.role === 'child'
      && member.status === 'approved';
    const canTransferParent = dashboard?.viewer?.role === 'parent'
      && dashboard?.viewer?.status === 'approved'
      && dashboard?.viewer?.id === dashboard?.team?.ownerId
      && member.userId !== dashboard?.viewer?.id
      && member.status === 'approved';

    if (options.reviewable) {
      const approveDisabled = Boolean(dashboard?.team?.isFull);
      const approveLabel = approveDisabled ? 'Family Full' : 'Approve';
      const requestedRole = member.registeredRole || member.role;
      return `
        <div class="member-card">
          <div class="member-info">
            <p class="member-name">${displayName}</p>
            <p class="member-email">${email}</p>
            <p class="member-meta">${[studyYearLabel, childFocusLabel, this.formatDashboardRole(requestedRole, { request: true })].filter(Boolean).join(' · ')}</p>
          </div>
          <div class="member-card-actions">
            <button class="action-btn action-approve" data-review-membership="${member.id}" data-review-decision="approved" ${approveDisabled ? 'disabled' : ''}>${approveLabel}</button>
            <button class="action-btn action-decline" data-review-membership="${member.id}" data-review-decision="declined">Decline</button>
          </div>
        </div>
      `;
    }

    const actionButtons = [];
    if (canPromoteParent) {
      actionButtons.push(`<button class="action-btn action-transfer" data-make-parent="${member.id}">Make Parent</button>`);
    }
    if (canTransferParent) {
      actionButtons.push(`<button class="action-btn action-transfer" data-transfer-parent="${member.id}">Make Primary Parent</button>`);
    }

    const trailingMarkup = actionButtons.length
      ? `<div class="member-card-actions">${actionButtons.join('')}<span class="member-status ${this.escapeHtml(member.status)}">${statusLabel}</span></div>`
      : `<span class="member-status ${this.escapeHtml(member.status)}">${statusLabel}</span>`;

    return `
      <div class="member-card">
        <div class="member-info">
          <p class="member-name">${displayName}</p>
          <p class="member-email">${email}</p>
          <p class="member-meta">${memberMeta}</p>
        </div>
        ${trailingMarkup}
      </div>
    `;
  },

  async reviewRequest(button, membershipId, decision) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = decision === 'approved' ? 'Approving...' : 'Declining...';

    try {
      await this.apiRequest('/api/team/approve', {
        method: 'POST',
        body: {
          membershipId,
          decision,
        },
      });

      await this.loadDashboard();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to review this request');
      button.disabled = false;
      button.textContent = originalText;
    }
  },

  openInviteEmail() {
    const dashboard = this.state.dashboard;
    if (!dashboard?.team?.joinCode) {
      return;
    }

    const inviteLink = `${window.location.origin}/join?code=${encodeURIComponent(dashboard.team.joinCode)}&familyInvite=1`;
    const subject = encodeURIComponent(`Join my FamHack family: ${dashboard.team.name}`);
    const body = encodeURIComponent([
      'Hi,',
      '',
      `Join my FamHack family "${dashboard.team.name}".`,
      `Family code: ${dashboard.team.joinCode}`,
      `Child letter link: ${inviteLink}`,
      '',
      'Open the link or paste the code into the FamHack join flow, then send your request for approval.',
    ].join('\n'));

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  },

  async handleAddPoolChild(button, poolEntryId) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Adding...';

    try {
      await this.apiRequest('/api/team/pool-add', {
        method: 'POST',
        body: {
          poolEntryId,
        },
      });

      await this.loadDashboard();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to add this child to your family');
      button.disabled = false;
      button.textContent = originalText;
    }
  },

  async handleTransferParent(button, membershipId) {
    const confirmed = window.confirm('Make this approved family member the new primary parent for the family?');
    if (!confirmed) {
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Transferring...';

    try {
      await this.apiRequest('/api/team/transfer-parent', {
        method: 'POST',
        body: {
          membershipId,
        },
      });

      await this.loadDashboard();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to transfer primary parent ownership');
      button.disabled = false;
      button.textContent = originalText;
    }
  },

  async handleMakeParent(button, membershipId) {
    const confirmed = window.confirm('Make this approved family member a parent?');
    if (!confirmed) {
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Updating...';

    try {
      await this.apiRequest('/api/team/transfer-parent', {
        method: 'POST',
        body: {
          membershipId,
          action: 'parent',
        },
      });

      await this.loadDashboard();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to change this family role');
      button.disabled = false;
      button.textContent = originalText;
    }
  },

  async copyFieldValue(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) {
      return;
    }

    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Copied!';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = buttonId === 'sign-out-btn' ? 'Sign out' : 'Copy';
        button.classList.remove('copied');
      }, 1500);
    } catch (error) {
      console.error(error);
    }
  },

  async handleSignOut() {
    await this.supabase.auth.signOut();
    this.resetAuthFlowState();
    this.redirect('/register');
  },

  setDashboardLoading(isLoading) {
    const loader = document.getElementById('dashboard-loading');
    const body = document.getElementById('dashboard-body');

    if (loader) {
      loader.hidden = !isLoading;
    }

    if (body) {
      body.hidden = isLoading;
    }

    if (!isLoading && body && typeof window.gsap !== 'undefined') {
      window.gsap.fromTo(body, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    }
  },

  setDangerPanelOpen(isOpen, { instant = false } = {}) {
    const dangerSection = document.getElementById('danger-section');
    const dangerPanel = document.getElementById('danger-panel');
    const dangerToggleButton = document.getElementById('danger-toggle-btn');
    const deleteTeamConfirmInput = document.getElementById('delete-team-confirm-input');

    if (!dangerPanel) {
      return;
    }

    const syncDangerToggleState = (open) => {
      if (!dangerToggleButton) {
        return;
      }

      dangerToggleButton.setAttribute('aria-expanded', String(open));
      dangerToggleButton.textContent = open ? 'Nevermind' : 'Delete Family';
      dangerToggleButton.classList.toggle('is-open', open);
    };

    if (instant || typeof window.gsap === 'undefined') {
      dangerSection?.classList.toggle('is-expanded', isOpen);
      syncDangerToggleState(isOpen);
      dangerPanel.hidden = !isOpen;
      if (isOpen) {
        dangerPanel.style.opacity = '1';
        dangerPanel.style.transform = 'translateY(0)';
      } else {
        dangerPanel.style.opacity = '';
        dangerPanel.style.transform = '';
        this.showFieldError('delete-team-confirm-error', '');
        if (deleteTeamConfirmInput) {
          deleteTeamConfirmInput.value = '';
        }
      }
      return;
    }

    window.gsap.killTweensOf(dangerPanel);

    if (isOpen) {
      syncDangerToggleState(true);
      dangerSection?.classList.add('is-expanded');
      dangerPanel.hidden = false;
      window.gsap.fromTo(
        dangerPanel,
        { height: 0, opacity: 0, y: -10 },
        { height: 'auto', opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' }
      );
    } else {
      window.gsap.to(dangerPanel, {
        height: 0,
        opacity: 0,
        y: -10,
        duration: 0.22,
        ease: 'power2.in',
        onComplete: () => {
          dangerPanel.hidden = true;
          dangerSection?.classList.remove('is-expanded');
          syncDangerToggleState(false);
          window.gsap.set(dangerPanel, { clearProps: 'all' });
          this.showFieldError('delete-team-confirm-error', '');
          if (deleteTeamConfirmInput) {
            deleteTeamConfirmInput.value = '';
          }
        },
      });
    }
  },

  toggleDangerPanel() {
    const dangerPanel = document.getElementById('danger-panel');
    if (!dangerPanel) {
      return;
    }

    this.setDangerPanelOpen(dangerPanel.hidden);
  },

  async handleLeaveTeam() {
    const leaveTeamButton = document.getElementById('leave-team-btn');
    const deleteTeamConfirmInput = document.getElementById('delete-team-confirm-input');
    const dashboard = this.state.dashboard;
    if (!leaveTeamButton || !dashboard) {
      return;
    }

    const isPrimaryParent = dashboard.viewer.role === 'parent'
      && dashboard.viewer.status === 'approved'
      && dashboard.viewer.id === dashboard.team.ownerId;
    const isDeletingFamily = isPrimaryParent
      && dashboard.members.length === 1
      && dashboard.pendingRequests.length === 0;
    const isPending = dashboard.viewer.status === 'pending';

    this.showFieldError('delete-team-confirm-error', '');

    if (isDeletingFamily) {
      const typedName = String(deleteTeamConfirmInput?.value || '').trim();
      if (typedName !== dashboard.team.name) {
        this.showFieldError('delete-team-confirm-error', 'Type your family name exactly before deleting it.');
        deleteTeamConfirmInput?.focus();
        return;
      }
    } else {
      const confirmed = window.confirm(
        isPending
          ? 'Cancel this join request?'
          : 'Leave this family? You will need a new family code or invite link to join again.'
      );

      if (!confirmed) {
        return;
      }
    }

    this.setButtonState(leaveTeamButton, {
      busy: true,
      label: isDeletingFamily ? 'Deleting...' : isPending ? 'Cancelling...' : 'Leaving...',
      idleLabel: isDeletingFamily ? 'Delete Family' : isPending ? 'Cancel Request' : 'Leave Family',
    });

    try {
      await this.apiRequest('/api/team/leave', {
        method: 'POST',
      });

      this.state.dashboard = null;
      this.redirect('/register');
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to leave this family');
      this.setButtonState(leaveTeamButton, {
        busy: false,
        label: isDeletingFamily ? 'Deleting...' : isPending ? 'Cancelling...' : 'Leaving...',
        idleLabel: isDeletingFamily ? 'Delete Family' : isPending ? 'Cancel Request' : 'Leave Family',
      });
    }
  },

  redirectToDashboard() {
    this.redirect('/dashboard');
  },

  redirect(path) {
    if (typeof window.famhackNavigateWithTransition === 'function') {
      const handled = window.famhackNavigateWithTransition(path);
      if (handled !== false) {
        return;
      }
    }

    window.location.href = path;
  },

  showFatalError(message) {
    if (this.state.page === 'register') {
      this.showPageMessage('register-page-message', message);
    } else if (this.state.page === 'join') {
      this.showPageMessage('join-page-message', message);
    } else if (this.state.page === 'ctf') {
      this.setCtfLoading(false);
      const banner = document.getElementById('ctf-status-banner');
      const shell = document.getElementById('ctf-challenge-shell');
      if (banner) {
        banner.hidden = false;
        banner.classList.remove('is-success');
        banner.textContent = message;
      }
      if (shell) {
        shell.innerHTML = `
          <section class="ctf-challenge-card">
            <p class="ctf-step-kicker">CTF unavailable</p>
            <h2 class="ctf-challenge-title">This page cannot open yet.</h2>
            <p class="ctf-challenge-copy">${this.escapeHtml(message)}</p>
          </section>
        `;
      }
    } else {
      this.setDashboardLoading(false);
      const banner = document.getElementById('dashboard-status-banner');
      if (banner) {
        banner.hidden = false;
        banner.textContent = message;
      }
    }
  },

  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  },

  formatDateTime(value) {
    if (!value) {
      return '';
    }

    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  },

  initNavigation() {
    const burger = document.querySelector('.nav-burger');
    const flyout = document.querySelector('.flyout-menu');
    const closeBtn = document.querySelector('.flyout-close');
    const backdrop = document.querySelector('.nav-blur');
    const closeClickArea = document.querySelector('.nav-close-click-area');
    const menuItems = flyout ? flyout.querySelectorAll('.menu-item') : [];
    const menuContent = flyout ? flyout.querySelector('.menu-content') : null;

    if (!burger || !flyout) {
      return;
    }

    const hasGSAP = typeof window.gsap !== 'undefined';
    let menuTimeline = null;

    const openMenu = () => {
      flyout.classList.add('is-open');
      document.body.classList.add('menu-open');

      if (!hasGSAP) {
        return;
      }

      if (menuTimeline) menuTimeline.kill();
      menuTimeline = window.gsap.timeline();

      menuTimeline.fromTo(
        flyout,
        { x: '100%', opacity: 0 },
        { x: '0%', opacity: 1, duration: 0.4, ease: 'power3.out' }
      );

      if (menuItems.length) {
        menuTimeline.fromTo(
          menuItems,
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'power2.out' },
          '-=0.2'
        );
      }

      if (menuContent) {
        menuTimeline.fromTo(menuContent, { scale: 0.95 }, { scale: 1, duration: 0.3, ease: 'power2.out' }, 0);
      }
    };

    const closeMenu = () => {
      if (!hasGSAP) {
        flyout.classList.remove('is-open');
        document.body.classList.remove('menu-open');
        return;
      }

      if (menuTimeline) menuTimeline.kill();
      menuTimeline = window.gsap.timeline({
        onComplete: () => {
          flyout.classList.remove('is-open');
          document.body.classList.remove('menu-open');
          window.gsap.set(flyout, { clearProps: 'all' });
          window.gsap.set(menuItems, { clearProps: 'all' });
          if (menuContent) {
            window.gsap.set(menuContent, { clearProps: 'all' });
          }
        },
      });

      if (menuItems.length) {
        menuTimeline.to(menuItems, { y: -20, opacity: 0, duration: 0.2, stagger: 0.03, ease: 'power2.in' });
      }

      menuTimeline.to(flyout, { x: '100%', opacity: 0, duration: 0.35, ease: 'power3.in' }, '-=0.1');
    };

    burger.addEventListener('click', openMenu);
    closeBtn?.addEventListener('click', closeMenu);
    backdrop?.addEventListener('click', closeMenu);
    closeClickArea?.addEventListener('click', closeMenu);
    menuItems.forEach((item) => {
      item.querySelectorAll('a[href]').forEach((link) => {
        link.addEventListener('click', closeMenu);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && flyout.classList.contains('is-open')) {
        closeMenu();
      }
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  FamHack.init();
});

window.FamHack = FamHack;
