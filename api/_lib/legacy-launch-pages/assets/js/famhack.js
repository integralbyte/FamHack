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
    registerIntent: 'role',
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
        if (!session) {
          this.resetAuthFlowState();
        }
      });

      await this.hydrateSession();

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

  getSelectedStudyYear() {
    return String(document.getElementById('study-year-input')?.value || '').trim().toLowerCase();
  },

  formatDashboardRole(role, { primary = false, request = false } = {}) {
    if (request) {
      return 'Join Request';
    }

    if (primary && role === 'parent') {
      return 'Primary Parent';
    }

    return role === 'parent' ? 'Parent' : 'Student';
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

  setRegisterEmailMode(mode = 'parent') {
    if (this.state.page !== 'register') {
      return;
    }

    const emailLabel = document.getElementById('email-label');
    const emailInput = document.getElementById('email-input');

    if (!emailLabel || !emailInput) {
      return;
    }

    if (mode === 'signin') {
      emailLabel.textContent = 'Email Address';
      emailInput.placeholder = 's1234567@ed.ac.uk';
      return;
    }

    emailLabel.textContent = 'Your Email Address';
    emailInput.placeholder = 's1234567@ed.ac.uk';
  },

  resetAuthFlowState() {
    clearInterval(this.state.resendTimer);
    this.state.resendTimer = null;
    clearTimeout(this.state.ctfAdvanceTimer);
    this.state.ctfAdvanceTimer = null;
    this.state.pendingEmail = '';
    this.state.teamPreview = null;
    this.state.dashboard = null;
    this.state.ctf = null;
    this.state.ctfPendingAdvanceState = null;
    this.state.ctfRecentKeys = [];
    this.state.ctfKonamiBusy = false;
    this.state.ctfKonamiRetry = false;
    this.state.ctfKonamiSolved = false;
    this.state.registerIntent = 'role';
    this.clearOTPInputs();
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

  async initHomePage() {
    this.initHomeLogoMotion();

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
    document.getElementById('choose-parent-btn')?.addEventListener('click', () => this.handleChooseParent());
    document.getElementById('choose-student-btn')?.addEventListener('click', () => this.handleChooseStudent());
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

    this.setRegisterIntro('What are you?', 'Choose how you want to enter FamHack.');
    this.setRegisterEmailMode('parent');
    this.state.registerIntent = 'role';

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

      if (this.state.teamPreview) {
        this.showPageMessage('join-page-message', 'You are already signed in. Review the family below and submit your request.');
        this.showStep('join-team');
      } else {
        this.showPageMessage('join-page-message', 'You are already signed in. Enter a family code to continue.');
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

  async initCtfPage() {
    const signOutButton = document.getElementById('ctf-sign-out-btn');
    signOutButton?.addEventListener('click', () => this.handleSignOut());
    if (signOutButton) {
      signOutButton.hidden = !this.state.session;
    }
    document.getElementById('ctf-challenge-shell')?.addEventListener('submit', (event) => this.handleCtfSubmit(event));
    document.getElementById('ctf-challenge-shell')?.addEventListener('click', (event) => {
      const nextButton = event.target.closest('[data-ctf-next]');
      if (nextButton) {
        this.advanceSolvedCtfChallenge();
      }
    });

    document.addEventListener('keydown', (event) => this.handleKonamiKeydown(event));

    this.setCtfLoading(true);
    await this.loadCtfState();
  },

  handleChooseParent() {
    this.state.registerIntent = 'parent';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterEmailMode('parent');
    this.setRegisterIntro(
      'Create your academic family',
      'Parents verify their email first, then create the family dashboard.'
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

  handleChooseSignIn() {
    this.state.registerIntent = 'signin';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterEmailMode('signin');
    this.setRegisterIntro(
      'Sign in to FamHack',
      'Use your email to get back into your account. If you already have a family, you will land on your dashboard.'
    );

    if (this.state.session) {
      this.showPageMessage('register-page-message', 'You are already signed in.');
      return;
    }

    this.showStep('email');
    this.showPageMessage('register-page-message', '');
    document.getElementById('email-input')?.focus();
  },

  handleChooseStudent() {
    this.state.registerIntent = 'student';
    this.showFieldError('role-error', '');
    this.showPageMessage('register-page-message', '');
    this.setRegisterIntro(
      'Join an existing family',
      'Enter the family code from an approved parent, or open the invite link they sent you.'
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
    this.state.registerIntent = 'role';
    this.showFieldError('role-error', '');
    this.setRegisterEmailMode('parent');
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
        if (this.state.registerIntent === 'signin') {
          this.handleBackToRole();
          this.showPageMessage(
            'register-page-message',
            'Signed in. Choose whether you are creating a family or joining one.'
          );
        } else {
          this.showStep('create-team');
          this.showPageMessage('register-page-message', 'Verified. Finish creating your family.');
        }
      } else if (this.state.page === 'join') {
        const joinCode = this.normalizeJoinCode(document.getElementById('join-code-input')?.value);
        const team = this.state.teamPreview || await this.lookupTeam(joinCode, { showErrors: true });
        if (!team) {
          this.showStep('email');
          return;
        }

        this.showStep('join-team');
        this.showPageMessage('join-page-message', 'Verified. Submit your request and an approved parent can review it.');
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
    const studyYear = this.getSelectedStudyYear();
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

    if (!studyYear) {
      this.showFieldError('team-error', 'Choose your year of study');
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
          studyYear,
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
    const studyYear = this.getSelectedStudyYear();
    const joinCode = this.normalizeJoinCode(document.getElementById('join-code-input')?.value || this.state.teamPreview?.joinCode);

    this.showFieldError('join-request-error', '');
    this.showFieldError('join-code-error', '');

    if (!fullName) {
      this.showFieldError('join-request-error', 'Your name is required');
      return;
    }

    if (!studyYear) {
      this.showFieldError('join-request-error', 'Choose your year of study');
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
          studyYear,
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

  async fetchCtfState() {
    return this.apiRequest('/api/ctf/state');
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
      this.setCtfLoading(false);
    } catch (error) {
      console.error(error);
      if (error.status === 401) {
        this.redirect('/register');
        return;
      }
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
        statusBanner.textContent = ctf.completionMessage.copy;
      } else {
        statusBanner.classList.remove('is-success');
        statusBanner.textContent = 'The first person to clear all six challenges wins the prize.';
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

    container.innerHTML = ctf.leaderboard.map((row) => {
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
      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-success">
          <p class="ctf-step-kicker">Run Complete</p>
          <h2 class="ctf-challenge-title">${this.escapeHtml(ctf.completionMessage?.title || 'Every signal is clear.')}</h2>
          <p class="ctf-challenge-copy">${this.escapeHtml(ctf.completionMessage?.copy || 'You finished the full FamHack CTF.')}</p>
        </section>
      `;
      return;
    }

    const gate = this.state.ctfPendingAdvanceState;
    if (gate) {
      if (gate.mode === 'konami') {
        shell.innerHTML = `
          <section class="ctf-challenge-card ctf-challenge-card-konami">
            <div class="ctf-konami-stage" tabindex="0" aria-label="Konami unlocked">
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

    if (challenge.mode === 'konami') {
      const konamiClass = this.state.ctfKonamiSolved ? ' is-solved' : '';
      const konamiText = this.state.ctfKonamiSolved ? 'Konami noticed.' : challenge.prompt;

      shell.innerHTML = `
        <section class="ctf-challenge-card ctf-challenge-card-konami">
          <div class="ctf-konami-stage" tabindex="0" aria-label="Konami challenge">
            <p id="ctf-konami-text" class="ctf-konami-text${konamiClass}">${this.escapeHtml(konamiText)}</p>
          </div>
          <p id="ctf-answer-error" class="error-message ctf-inline-error"></p>
        </section>
      `;

      document.querySelector('.ctf-konami-stage')?.focus();
      return;
    }

    shell.innerHTML = `
      <form class="ctf-challenge-card" autocomplete="off">
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
      </form>
    `;
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
    if (!form) {
      return;
    }

    event.preventDefault();

    const ctf = this.state.ctf;
    const challenge = ctf?.currentChallenge;
    if (!challenge || challenge.mode === 'konami') {
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
    const membersList = document.getElementById('members-list');

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
      inviteLinkInput.value = `${window.location.origin}/join?code=${encodeURIComponent(dashboard.team.joinCode)}`;
    }

    if (inviteGrid) {
      inviteGrid.hidden = !(dashboard.viewer.role === 'parent' && dashboard.viewer.status === 'approved');
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
        statusBanner.textContent = 'Share the family code or the invite link below with other parents and students.';
      }
    }

    this.renderApprovedMembers(membersList, dashboard.members, dashboard);

    if (dashboard.viewer.role === 'parent' && dashboard.viewer.status === 'approved') {
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

  memberCardTemplate(member, options = {}) {
    const dashboard = options.dashboard || this.state.dashboard;
    const displayName = this.escapeHtml(member.fullName || member.email || 'Unknown member');
    const email = this.escapeHtml(member.email || '');
    const isPrimaryParent = dashboard?.team?.ownerId && member.userId === dashboard.team.ownerId && member.role === 'parent';
    const roleLabel = this.formatDashboardRole(member.role, { primary: isPrimaryParent });
    const statusLabel = member.status.charAt(0).toUpperCase() + member.status.slice(1);
    const studyYearLabel = this.escapeHtml(member.studyYearLabel || '');
    const memberMeta = studyYearLabel ? `${roleLabel} · ${studyYearLabel}` : roleLabel;
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
      const approveStudentLabel = approveDisabled ? 'Family Full' : 'Approve as Student';
      const approveParentLabel = approveDisabled ? 'Family Full' : 'Approve as Parent';
      return `
        <div class="member-card">
          <div class="member-info">
            <p class="member-name">${displayName}</p>
            <p class="member-email">${email}</p>
            <p class="member-meta">${studyYearLabel ? `${studyYearLabel} · ${this.formatDashboardRole(member.role, { request: true })}` : this.formatDashboardRole(member.role, { request: true })}</p>
          </div>
          <div class="member-card-actions">
            <button class="action-btn action-approve" data-review-membership="${member.id}" data-review-decision="approved" data-review-role="child" ${approveDisabled ? 'disabled' : ''}>${approveStudentLabel}</button>
            <button class="action-btn action-approve" data-review-membership="${member.id}" data-review-decision="approved" data-review-role="parent" ${approveDisabled ? 'disabled' : ''}>${approveParentLabel}</button>
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
    const approvedRole = decision === 'approved'
      ? String(button.dataset.reviewRole || '').trim().toLowerCase()
      : '';

    try {
      await this.apiRequest('/api/team/approve', {
        method: 'POST',
        body: {
          membershipId,
          decision,
          ...(approvedRole ? { role: approvedRole } : {}),
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
