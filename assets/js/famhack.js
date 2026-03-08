import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const DEFAULT_FAMILY_FLOW_OPENS_AT = '2026-03-14T00:00:00Z';

const FamHack = {
  config: {
    otpLength: 6,
    otpResendDelay: 30,
    familyFlowOpensAt: DEFAULT_FAMILY_FLOW_OPENS_AT,
  },

  state: {
    page: null,
    session: null,
    pendingEmail: '',
    registerIntent: '',
    resendTimer: null,
    logoJitterElement: null,
    logoResetTimer: null,
    logoLastPointerX: null,
    logoLastPointerY: null,
  },

  async init() {
    this.state.page = this.getPage();
    this.initNavigation();
    this.initOTPInputs();

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
        if (!session) {
          this.resetAuthFlowState();
        }
      });

      await this.hydrateSession();

      if (this.state.page === 'home') {
        await this.initHomePage();
      } else if (this.state.page === 'register') {
        await this.initRegisterPage();
      }
    } catch (error) {
      console.error(error);
      this.showFatalError(error.message || 'Unable to load FamHack right now.');
    }
  },

  getPage() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path.endsWith('/index.html')) return 'home';
    if (path === '/register' || path.endsWith('/register.html')) return 'register';
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

  getFamilyFlowOpensAt() {
    const releaseDate = new Date(this.config.familyFlowOpensAt || DEFAULT_FAMILY_FLOW_OPENS_AT);
    return Number.isNaN(releaseDate.getTime()) ? new Date(DEFAULT_FAMILY_FLOW_OPENS_AT) : releaseDate;
  },

  hasFamilyFlowOpened() {
    return Date.now() >= this.getFamilyFlowOpensAt().getTime();
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

  resetAuthFlowState() {
    clearInterval(this.state.resendTimer);
    this.state.resendTimer = null;
    this.state.pendingEmail = '';
    this.state.registerIntent = '';
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

    const { destination, label } = await this.resolveParticipateState();
    participateLink.href = destination;
    const labelNode = participateLink.querySelector('.button-label');
    if (labelNode) {
      labelNode.textContent = label;
    }

    participateLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.redirect(destination);
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

  async resolveParticipateState() {
    if (!this.state.session) {
      return {
        destination: '/register',
        label: 'Register',
      };
    }

    const registration = await this.fetchRegistrationStatus({ suppressErrors: true });
    if (registration?.viewer?.role) {
      return {
        destination: '/register',
        label: 'Registered',
      };
    }

    return {
      destination: '/register',
      label: 'Register',
    };
  },

  async initRegisterPage() {
    document.getElementById('choose-parent-btn')?.addEventListener('click', () => this.handleChooseRole('parent'));
    document.getElementById('choose-child-btn')?.addEventListener('click', () => this.handleChooseRole('child'));
    document.getElementById('back-to-role-btn')?.addEventListener('click', () => this.handleBackToRole());
    document.getElementById('send-otp-btn')?.addEventListener('click', () => this.handleSendOTP());
    document.getElementById('verify-otp-btn')?.addEventListener('click', () => this.handleVerifyOTP());
    document.getElementById('resend-otp-btn')?.addEventListener('click', () => this.handleResendOTP());

    const emailInput = document.getElementById('email-input');
    emailInput?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.handleSendOTP();
      }
    });

    if (this.hasFamilyFlowOpened()) {
      this.setRegisterIntro('Registration Closed', 'Team forming starts on 14 March 2026.');
      this.showStep('registered-success');
      this.setText('registered-success-heading', 'Registration is closed.');
      this.setText('registered-success-copy', 'The registration deadline was 13 March 2026 at 11:59 PM. Team forming starts on 14 March 2026.');
      return;
    }

    this.setRegisterIntro('Register for FamHack', 'Registration closes on 13 March 2026 at 11:59 PM.');
    this.showPageMessage('register-page-message', '');

    if (this.state.session) {
      const registration = await this.fetchRegistrationStatus({ suppressErrors: true });
      if (registration?.viewer?.role) {
        this.showRegisteredSuccess(registration.viewer);
        return;
      }
    }

    this.showStep('role');
  },

  async handleChooseRole(role) {
    this.state.registerIntent = role;
    this.showFieldError('role-error', '');
    this.showFieldError('email-error', '');
    this.showFieldError('otp-error', '');
    this.showPageMessage('register-page-message', '');

    if (role === 'parent') {
      this.setRegisterIntro('Register as a Parent', 'Use your university email to join the FamHack list.');
    } else {
      this.setRegisterIntro('Register as a Child', 'Use your university email to join the FamHack list.');
    }

    if (this.state.session) {
      await this.submitRegistrationInterest(role);
      return;
    }

    this.showStep('email');
    document.getElementById('email-input')?.focus();
  },

  handleBackToRole() {
    this.state.registerIntent = '';
    this.showFieldError('email-error', '');
    this.showFieldError('otp-error', '');
    this.setRegisterIntro('Register for FamHack', 'Registration closes on 13 March 2026 at 11:59 PM.');
    this.showStep('role');
  },

  async handleSendOTP() {
    const sendButton = document.getElementById('send-otp-btn');
    const emailInput = document.getElementById('email-input');
    const email = this.normalizeEmail(emailInput?.value);

    this.showFieldError('email-error', '');

    if (!this.state.registerIntent) {
      this.showFieldError('role-error', 'Choose whether you are registering as a parent or a child');
      this.showStep('role');
      return;
    }

    if (!this.validateEmail(email)) {
      this.showFieldError('email-error', this.getEmailValidationMessage());
      return;
    }

    this.setButtonState(sendButton, {
      busy: true,
      label: 'Sending...',
      idleLabel: 'Send OTP',
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
      this.showPageMessage('register-page-message', 'Verification code sent. Check your inbox.');
    } catch (error) {
      console.error(error);
      this.showFieldError('email-error', error.message || 'Unable to send verification code');
    } finally {
      this.setButtonState(sendButton, {
        busy: false,
        label: 'Sending...',
        idleLabel: 'Send OTP',
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
      await this.submitRegistrationInterest(this.state.registerIntent);
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

  async fetchRegistrationStatus({ suppressErrors = false } = {}) {
    try {
      return await this.apiRequest('/api/registration/status');
    } catch (error) {
      if (suppressErrors) {
        return null;
      }
      throw error;
    }
  },

  async submitRegistrationInterest(role) {
    if (!role) {
      this.showFieldError('role-error', 'Choose whether you are registering as a parent or a child');
      return;
    }

    try {
      const payload = await this.apiRequest('/api/registration/status', {
        method: 'POST',
        body: { role },
      });

      this.showRegisteredSuccess(payload.viewer);
    } catch (error) {
      console.error(error);

      if (error.status === 409) {
        const targetErrorId = document.querySelector('.register-step.active')?.dataset.step === 'otp'
          ? 'otp-error'
          : 'role-error';
        this.showFieldError(targetErrorId, error.message || 'Unable to save your registration');
        return;
      }

      if (this.state.session) {
        const registration = await this.fetchRegistrationStatus({ suppressErrors: true });
        if (registration?.viewer?.role) {
          this.showRegisteredSuccess(registration.viewer);
          return;
        }
      }

      const targetErrorId = document.querySelector('.register-step.active')?.dataset.step === 'otp'
        ? 'otp-error'
        : 'role-error';
      this.showFieldError(targetErrorId, error.message || 'Unable to save your registration');
    }
  },

  showRegisteredSuccess(viewer) {
    const roleLabel = viewer?.role === 'parent' ? 'parent' : 'child';
    this.setRegisterIntro('You’re registered.', 'See you on 14 March 2026 for team forming.');
    this.setText('registered-success-heading', 'See you on 14 March.');
    this.setText(
      'registered-success-copy',
      `You are registered as a ${roleLabel}. Team forming happens on 14 March 2026. Get in touch with your academic parents. If you cannot reach them, we will place you on a team.`
    );
    this.showPageMessage('register-page-message', '');
    this.showStep('registered-success');
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

  redirect(path) {
    window.location.href = path;
  },

  showFatalError(message) {
    if (this.state.page === 'register') {
      this.showPageMessage('register-page-message', message);
    }
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
