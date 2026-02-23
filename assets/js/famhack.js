import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const FamHack = {
  config: {
    otpLength: 6,
    otpResendDelay: 30,
    maxTeamSize: 15,
  },

  state: {
    page: null,
    session: null,
    pendingEmail: '',
    teamPreview: null,
    resendTimer: null,
    joinLookupTimer: null,
    participateDestination: null,
    participateLabel: null,
    participateCheckPromise: null,
    dashboard: null,
  },

  async init() {
    this.state.page = this.getPage();
    this.initOTPInputs();
    this.initNavigation();

    if (!this.state.page) {
      return;
    }

    try {
      const publicConfig = await this.fetchConfig();
      this.config = {
        ...this.config,
        ...publicConfig,
      };

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
      });

      await this.hydrateSession();

      if (this.state.page === 'home') {
        await this.initHomePage();
      } else if (this.state.page === 'register') {
        await this.initRegisterPage();
      } else if (this.state.page === 'join') {
        await this.initJoinPage();
      } else if (this.state.page === 'dashboard') {
        await this.initDashboardPage();
      }
    } catch (error) {
      console.error(error);
      this.showFatalError(error.message || 'Unable to load the registration flow right now.');
    }
  },

  getPage() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path.endsWith('/index.html')) return 'home';
    if (path === '/register' || path.endsWith('/register.html')) return 'register';
    if (path === '/join' || path.endsWith('/join.html')) return 'join';
    if (path === '/dashboard' || path.endsWith('/dashboard.html')) return 'dashboard';
    return null;
  },

  async fetchConfig() {
    const response = await fetch('/api/config');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load app configuration');
    }

    return payload;
  },

  async hydrateSession() {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      throw error;
    }

    this.state.session = data.session;
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

    this.setText('register-heading', heading);
    this.setText('register-subheading', subheading);
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
      if (!this.state.session) {
        return {
          destination: '/register',
          label: 'Participate',
        };
      }

      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (!dashboard) {
        return {
          destination: '/register',
          label: 'Participate',
        };
      }

      return {
        destination: '/dashboard',
        label: dashboard.viewer?.role === 'parent' ? 'Manage My Team' : 'View My Team',
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
    document.getElementById('choose-parent-btn')?.addEventListener('click', () => this.handleChooseParent());
    document.getElementById('choose-student-btn')?.addEventListener('click', () => this.handleChooseStudent());
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

    this.setRegisterIntro('What are you?', 'Choose how you want to enter FamHack.');

    if (this.state.session) {
      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (dashboard) {
        this.redirectToDashboard();
        return;
      }

      this.showStep('role');
      this.showPageMessage(
        'register-page-message',
        'You are already signed in. Choose whether you are creating a family or joining one.'
      );
    }
  },

  async initJoinPage() {
    document.getElementById('send-otp-btn')?.addEventListener('click', () => this.handleSendOTP());
    document.getElementById('verify-otp-btn')?.addEventListener('click', () => this.handleVerifyOTP());
    document.getElementById('resend-otp-btn')?.addEventListener('click', () => this.handleResendOTP());
    document.getElementById('request-join-btn')?.addEventListener('click', () => this.handleJoinRequest());

    const joinCodeInput = document.getElementById('join-code-input');
    const emailInput = document.getElementById('email-input');
    const codeFromUrl = new URLSearchParams(window.location.search).get('code')
      || new URLSearchParams(window.location.search).get('t');

    if (joinCodeInput && codeFromUrl) {
      joinCodeInput.value = this.normalizeJoinCode(codeFromUrl);
      await this.lookupTeam(joinCodeInput.value, { showErrors: false });
    }

    joinCodeInput?.addEventListener('input', () => {
      joinCodeInput.value = this.normalizeJoinCode(joinCodeInput.value);
      this.showFieldError('join-code-error', '');
      clearTimeout(this.state.joinLookupTimer);
      if (!joinCodeInput.value) {
        this.renderTeamPreview(null);
        return;
      }
      this.state.joinLookupTimer = window.setTimeout(() => {
        this.lookupTeam(joinCodeInput.value, { showErrors: false }).catch((error) => console.error(error));
      }, 250);
    });

    joinCodeInput?.addEventListener('blur', () => {
      if (joinCodeInput.value) {
        this.lookupTeam(joinCodeInput.value, { showErrors: false }).catch((error) => console.error(error));
      }
    });

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

      if (emailInput && this.state.session.user?.email) {
        emailInput.value = this.state.session.user.email;
        emailInput.disabled = true;
      }

      this.setButtonLabel(document.getElementById('send-otp-btn'), 'Continue');
      this.showPageMessage('join-page-message', 'You are already signed in. Enter a family code to continue.');

      if (this.state.teamPreview) {
        this.showStep('join-team');
      }
    }
  },

  async initDashboardPage() {
    document.getElementById('copy-invite-btn')?.addEventListener('click', () => this.copyFieldValue('invite-link-input', 'copy-invite-btn'));
    document.getElementById('copy-code-btn')?.addEventListener('click', () => this.copyFieldValue('join-code-display', 'copy-code-btn'));
    document.getElementById('sign-out-btn')?.addEventListener('click', () => this.handleSignOut());
    document.getElementById('leave-team-btn')?.addEventListener('click', () => this.handleLeaveTeam());
    document.getElementById('danger-toggle-btn')?.addEventListener('click', () => this.toggleDangerPanel());

    if (!this.state.session) {
      this.redirect('/register');
      return;
    }

    this.setDashboardLoading(true);
    await this.loadDashboard();
  },

  handleChooseParent() {
    this.showFieldError('role-error', '');
    this.setRegisterIntro(
      'Create your academic family',
      'Academic parents verify their email first, then create the family dashboard.'
    );

    if (this.state.session) {
      this.showStep('create-team');
      this.showPageMessage('register-page-message', 'You are signed in. Finish creating your family.');
      return;
    }

    this.showStep('email');
    this.showPageMessage('register-page-message', '');
    document.getElementById('email-input')?.focus();
  },

  handleChooseStudent() {
    this.showFieldError('role-error', '');
    this.setRegisterIntro(
      'Join an existing family',
      'Enter the family code from your academic parent, or open the invite link they sent you.'
    );
    this.showStep('child');
    document.getElementById('role-family-code-input')?.focus();
  },

  handleChooseChild() {
    this.showFieldError('role-error', '');

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
    this.setRegisterIntro('What are you?', 'Choose how you want to enter FamHack.');
    this.showStep('role');
  },

  async handleSendOTP() {
    const sendButton = document.getElementById('send-otp-btn');
    const emailInput = document.getElementById('email-input');
    const email = this.normalizeEmail(emailInput?.value);

    this.showFieldError('email-error', '');
    this.showFieldError('join-code-error', '');

    if (this.state.page === 'join') {
      const joinCodeInput = document.getElementById('join-code-input');
      const joinCode = this.normalizeJoinCode(joinCodeInput?.value);

      if (joinCodeInput) {
        joinCodeInput.value = joinCode;
      }

      if (!joinCode) {
        this.showFieldError('join-code-error', 'Enter a valid family code');
        return;
      }

      const team = await this.lookupTeam(joinCode, { showErrors: true });
      if (!team) {
        return;
      }
    }

    if (this.state.session) {
      if (this.state.page === 'register') {
        this.showStep('create-team');
      } else if (this.state.page === 'join') {
        this.showStep('join-team');
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
      idleLabel: this.state.page === 'join' && this.state.session ? 'Continue' : 'Send OTP',
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
        idleLabel: this.state.page === 'join' && this.state.session ? 'Continue' : 'Send OTP',
      });
    }
  },

  async handleVerifyOTP() {
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
      const dashboard = await this.fetchDashboard({ suppressMissing: true });
      if (dashboard) {
        this.redirectToDashboard();
        return;
      }

      if (this.state.page === 'register') {
        this.showStep('create-team');
        this.showPageMessage('register-page-message', 'Verified. Finish creating your family.');
      } else if (this.state.page === 'join') {
        const joinCode = this.normalizeJoinCode(document.getElementById('join-code-input')?.value);
        const team = this.state.teamPreview || await this.lookupTeam(joinCode, { showErrors: true });
        if (!team) {
          this.showStep('email');
          return;
        }

        this.showStep('join-team');
        this.showPageMessage('join-page-message', 'Verified. Submit your request and your parent can review it.');
      }
    } catch (error) {
      console.error(error);
      this.showFieldError('otp-error', this.getFriendlyOtpErrorMessage(error));
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
            this.showFieldError('join-code-error', payload.error || 'That family code was not found');
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
        this.showFieldError('join-code-error', error.message || 'Unable to verify that family code');
      }
      return null;
    }
  },

  renderTeamPreview(team) {
    const preview = document.getElementById('team-preview');
    const previewName = document.getElementById('team-preview-name');
    const joinTeamName = document.getElementById('join-team-id');

    this.state.teamPreview = team || null;

    if (preview) {
      preview.hidden = !team;
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
    const teamName = document.getElementById('team-name-input')?.value?.trim() || '';

    this.showFieldError('team-error', '');

    if (!fullName) {
      this.showFieldError('team-error', 'Your name is required');
      return;
    }

    if (teamName.length < 3) {
      this.showFieldError('team-error', 'Choose a team name with at least 3 characters');
      return;
    }

    this.setButtonState(createButton, {
      busy: true,
      label: 'Creating...',
      idleLabel: 'Create Family',
    });

    try {
      await this.apiRequest('/api/team/create', {
        method: 'POST',
        body: {
          fullName,
          teamName,
        },
      });

      this.redirectToDashboard();
    } catch (error) {
      console.error(error);
      this.showFieldError('team-error', error.message || 'Unable to create your family');
    } finally {
      this.setButtonState(createButton, {
        busy: false,
        label: 'Creating...',
        idleLabel: 'Create Family',
      });
    }
  },

  async handleJoinRequest() {
    const joinButton = document.getElementById('request-join-btn');
    const fullName = document.getElementById('full-name-input')?.value?.trim() || '';
    const joinCode = this.normalizeJoinCode(document.getElementById('join-code-input')?.value || this.state.teamPreview?.joinCode);

    this.showFieldError('join-request-error', '');
    this.showFieldError('join-code-error', '');

    if (!fullName) {
      this.showFieldError('join-request-error', 'Your name is required');
      return;
    }

    if (!joinCode) {
      this.showFieldError('join-code-error', 'Enter a valid family code');
      this.showStep('email');
      return;
    }

    if (!this.state.teamPreview) {
      const team = await this.lookupTeam(joinCode, { showErrors: true });
      if (!team) {
        this.showStep('email');
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
          joinCode,
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
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = new Error(payload.error || 'Request failed');
      error.status = response.status;
      throw error;
    }

    return payload;
  },

  async fetchDashboard({ suppressMissing } = {}) {
    try {
      return await this.apiRequest('/api/team/dashboard');
    } catch (error) {
      if (suppressMissing && (error.status === 404 || error.status === 401)) {
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
        this.redirect('/register');
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
    const canDeleteFamily = dashboard.viewer.role === 'parent'
      && dashboard.members.length === 1
      && dashboard.pendingRequests.length === 0;
    const roleCopy = document.getElementById('dashboard-role-copy');
    const capacityCopy = document.getElementById('dashboard-capacity-copy');
    const teamName = document.getElementById('dashboard-team-name');
    const joinCodeDisplay = document.getElementById('join-code-display');
    const inviteLinkInput = document.getElementById('invite-link-input');
    const inviteGrid = document.getElementById('invite-grid');
    const dangerSection = document.getElementById('danger-section');
    const dangerToggleWrap = document.getElementById('danger-toggle-wrap');
    const dangerToggleButton = document.getElementById('danger-toggle-btn');
    const dangerPanel = document.getElementById('danger-panel');
    const dangerCopy = document.getElementById('danger-copy');
    const deleteTeamConfirmGroup = document.getElementById('delete-team-confirm-group');
    const deleteTeamConfirmInput = document.getElementById('delete-team-confirm-input');
    const deleteTeamConfirmHint = document.getElementById('delete-team-confirm-hint');
    const leaveTeamButton = document.getElementById('leave-team-btn');
    const statusBanner = document.getElementById('dashboard-status-banner');
    const pendingSection = document.getElementById('pending-section');
    const pendingList = document.getElementById('pending-list');
    const membersList = document.getElementById('members-list');

    if (teamName) {
      teamName.textContent = dashboard.team.name;
    }

    if (roleCopy) {
      roleCopy.textContent = dashboard.viewer.role === 'parent'
        ? 'Parent dashboard. Share the code and review join requests.'
        : 'Track your team status here.';
    }

    if (capacityCopy) {
      capacityCopy.textContent = `${dashboard.team.approvedCount} / ${dashboard.team.maxMembers} approved members`;
    }

    if (leaveTeamButton) {
      leaveTeamButton.hidden = true;
    }

    if (dangerSection && dangerCopy && deleteTeamConfirmGroup && leaveTeamButton && dangerToggleWrap && dangerToggleButton && dangerPanel) {
      dangerSection.hidden = true;
      dangerToggleWrap.hidden = true;
      dangerToggleButton.hidden = true;
      deleteTeamConfirmGroup.hidden = true;
      this.showFieldError('delete-team-confirm-error', '');

      if (deleteTeamConfirmInput) {
        deleteTeamConfirmInput.value = '';
      }

      if (dashboard.viewer.role === 'child') {
        dangerSection.hidden = false;
        dangerPanel.hidden = false;
        leaveTeamButton.hidden = false;
        leaveTeamButton.textContent = dashboard.viewer.status === 'pending' ? 'Cancel Request' : 'Leave Family';
        dangerCopy.textContent = dashboard.viewer.status === 'pending'
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
      inviteLinkInput.value = `${window.location.origin}/join?code=${encodeURIComponent(dashboard.team.joinCode)}`;
    }

    if (inviteGrid) {
      inviteGrid.hidden = dashboard.viewer.role !== 'parent';
    }

    if (statusBanner) {
      if (dashboard.viewer.role === 'child' && dashboard.viewer.status === 'pending') {
        statusBanner.hidden = false;
        statusBanner.textContent = 'Your join request is pending parent approval. You can cancel it from this page if you picked the wrong family.';
      } else if (dashboard.viewer.role === 'child') {
        statusBanner.hidden = false;
        statusBanner.textContent = `You are approved as a child in ${dashboard.team.name}.`;
      } else if (dashboard.team.isFull) {
        statusBanner.hidden = false;
        statusBanner.textContent = `This family is full at ${dashboard.team.approvedCount}/${dashboard.team.maxMembers}. Pending requests can be declined, but no further approvals can go through until someone leaves.`;
      } else {
        statusBanner.hidden = false;
        statusBanner.textContent = `Share code ${dashboard.team.joinCode} or the invite link below with your children. ${dashboard.team.slotsRemaining} spot${dashboard.team.slotsRemaining === 1 ? '' : 's'} remaining.`;
      }
    }

    this.renderApprovedMembers(membersList, dashboard.members, dashboard);

    if (dashboard.viewer.role === 'parent') {
      pendingSection.hidden = false;
      this.renderPendingMembers(pendingList, dashboard.pendingRequests, dashboard);
    } else if (pendingSection) {
      pendingSection.hidden = true;
    }
  },

  renderApprovedMembers(container, members, dashboard) {
    if (!container) return;

    container.innerHTML = '';
    if (!members.length) {
      container.innerHTML = '<p class="empty-state">No approved members yet.</p>';
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

  memberCardTemplate(member, options = {}) {
    const displayName = this.escapeHtml(member.fullName || member.email || 'Unknown member');
    const email = this.escapeHtml(member.email || '');
    const roleLabel = member.role === 'parent' ? 'Parent' : 'Child';
    const statusLabel = member.status.charAt(0).toUpperCase() + member.status.slice(1);
    const dashboard = options.dashboard || this.state.dashboard;
    const canTransferParent = dashboard?.viewer?.role === 'parent'
      && member.role === 'child'
      && member.status === 'approved';

    if (options.reviewable) {
      const approveDisabled = Boolean(dashboard?.team?.isFull);
      const approveLabel = approveDisabled ? 'Family Full' : 'Approve';
      return `
        <div class="member-card">
          <div class="member-info">
            <p class="member-name">${displayName}</p>
            <p class="member-email">${email}</p>
            <p class="member-meta">${roleLabel} Request</p>
          </div>
          <div class="member-card-actions">
            <button class="action-btn action-approve" data-review-membership="${member.id}" data-review-decision="approved" ${approveDisabled ? 'disabled' : ''}>${approveLabel}</button>
            <button class="action-btn action-decline" data-review-membership="${member.id}" data-review-decision="declined">Decline</button>
          </div>
        </div>
      `;
    }

    const trailingMarkup = canTransferParent
      ? `<div class="member-card-actions"><button class="action-btn action-transfer" data-transfer-parent="${member.id}">Make Parent</button><span class="member-status ${this.escapeHtml(member.status)}">${statusLabel}</span></div>`
      : `<span class="member-status ${this.escapeHtml(member.status)}">${statusLabel}</span>`;

    return `
      <div class="member-card">
        <div class="member-info">
          <p class="member-name">${displayName}</p>
          <p class="member-email">${email}</p>
          <p class="member-meta">${roleLabel}</p>
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

  async handleTransferParent(button, membershipId) {
    const confirmed = window.confirm('Make this approved child the new parent for the family?');
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
      window.alert(error.message || 'Unable to transfer parent ownership');
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
    const dangerPanel = document.getElementById('danger-panel');
    const dangerToggleButton = document.getElementById('danger-toggle-btn');
    const deleteTeamConfirmInput = document.getElementById('delete-team-confirm-input');

    if (!dangerPanel) {
      return;
    }

    if (dangerToggleButton) {
      dangerToggleButton.setAttribute('aria-expanded', String(isOpen));
    }

    if (instant || typeof window.gsap === 'undefined') {
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

    const isDeletingFamily = dashboard.viewer.role === 'parent'
      && dashboard.members.length === 1
      && dashboard.pendingRequests.length === 0;
    const isPending = dashboard.viewer.role === 'child' && dashboard.viewer.status === 'pending';

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
    window.location.href = path;
  },

  showFatalError(message) {
    if (this.state.page === 'register') {
      this.showPageMessage('register-page-message', message);
    } else if (this.state.page === 'join') {
      this.showPageMessage('join-page-message', message);
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
