/**
 * FamHack - Hackathon Registration System
 * Handles email validation, OTP verification, and team management
 */

const FamHack = {
  config: {
    emailDomain: '@ed.ac.uk',
    otpLength: 6,
    otpResendDelay: 30, // seconds
  },

  // State
  state: {
    currentEmail: null,
    teamId: null,
    isTeamLeader: false,
  },

  /**
   * Initialize the application
   */
  init() {
    this.initOTPInputs();
    this.initForms();
    this.initDashboard();
    this.initNavigation();
    this.checkURLParams();
  },

  /**
   * Validate email against @ed.ac.uk domain
   */
  validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim().toLowerCase();
    return trimmed.endsWith(this.config.emailDomain) && trimmed.length > this.config.emailDomain.length;
  },

  /**
   * Mock send OTP (simulates API call)
   */
  async sendOTP(email) {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(`OTP sent to ${email}`);
        resolve({ success: true, message: 'OTP sent successfully' });
      }, 1500);
    });
  },

  /**
   * Mock verify OTP (accepts any 6-digit code)
   */
  async verifyOTP(otp) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const isValid = otp && otp.length === this.config.otpLength && /^\d+$/.test(otp);
        if (isValid) {
          // Generate team ID if not joining a team
          if (!this.state.teamId) {
            this.state.teamId = this.generateTeamId();
            this.state.isTeamLeader = true;
          }
          // Store registration in localStorage
          this.saveRegistration();
          resolve({ success: true, teamId: this.state.teamId });
        } else {
          resolve({ success: false, message: 'Invalid OTP' });
        }
      }, 1000);
    });
  },

  /**
   * Generate a random team ID
   */
  generateTeamId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Generate invite link for team
   */
  generateInviteLink() {
    const teamId = this.state.teamId || this.getStoredTeamId();
    if (!teamId) return null;
    return `${window.location.origin}/join.html?t=${teamId}`;
  },

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch (err) {
        document.body.removeChild(textArea);
        return false;
      }
    }
  },

  /**
   * Initialize OTP input fields with auto-advance
   */
  initOTPInputs() {
    const otpContainer = document.querySelector('.otp-inputs');
    if (!otpContainer) return;

    const inputs = otpContainer.querySelectorAll('.otp-digit');

    inputs.forEach((input, index) => {
      // Handle input
      input.addEventListener('input', (e) => {
        const value = e.target.value;

        // Only allow digits
        e.target.value = value.replace(/\D/g, '').slice(0, 1);

        // Auto-advance to next input
        if (e.target.value && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }

        // Check if all fields are filled
        this.checkOTPComplete(inputs);
      });

      // Handle backspace
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
          inputs[index - 1].focus();
        }
      });

      // Handle paste
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, this.config.otpLength);

        pastedData.split('').forEach((char, i) => {
          if (inputs[i]) {
            inputs[i].value = char;
          }
        });

        // Focus last filled input or next empty
        const lastFilledIndex = Math.min(pastedData.length - 1, inputs.length - 1);
        if (lastFilledIndex >= 0) {
          inputs[lastFilledIndex].focus();
        }

        this.checkOTPComplete(inputs);
      });
    });
  },

  /**
   * Check if OTP is complete and enable verify button
   */
  checkOTPComplete(inputs) {
    const otp = Array.from(inputs).map(i => i.value).join('');
    const verifyBtn = document.getElementById('verify-otp-btn');
    if (verifyBtn) {
      verifyBtn.disabled = otp.length !== this.config.otpLength;
    }
  },

  /**
   * Get OTP value from inputs
   */
  getOTPValue() {
    const inputs = document.querySelectorAll('.otp-digit');
    return Array.from(inputs).map(i => i.value).join('');
  },

  /**
   * Clear OTP inputs
   */
  clearOTPInputs() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach(input => input.value = '');
    if (inputs[0]) inputs[0].focus();
  },

  /**
   * Show a specific step in the registration flow
   */
  showStep(stepName) {
    const steps = document.querySelectorAll('.register-step');
    steps.forEach(step => {
      step.classList.remove('active');
      if (step.dataset.step === stepName) {
        step.classList.add('active');
        // Use GSAP for animation if available
        if (typeof gsap !== 'undefined') {
          gsap.fromTo(step,
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
          );
        }
      }
    });
  },

  /**
   * Initialize form handlers
   */
  initForms() {
    // Email form
    const sendOtpBtn = document.getElementById('send-otp-btn');
    if (sendOtpBtn) {
      sendOtpBtn.addEventListener('click', () => this.handleSendOTP());
    }

    // Email input enter key
    const emailInput = document.getElementById('email-input');
    if (emailInput) {
      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleSendOTP();
        }
      });
    }

    // OTP verification
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    if (verifyOtpBtn) {
      verifyOtpBtn.addEventListener('click', () => this.handleVerifyOTP());
    }

    // Resend OTP
    const resendBtn = document.getElementById('resend-otp-btn');
    if (resendBtn) {
      resendBtn.addEventListener('click', () => this.handleResendOTP());
    }
  },

  /**
   * Handle send OTP button click
   */
  async handleSendOTP() {
    const emailInput = document.getElementById('email-input');
    const errorEl = document.getElementById('email-error');
    const sendBtn = document.getElementById('send-otp-btn');

    if (!emailInput) return;

    const email = emailInput.value.trim().toLowerCase();

    // Validate email
    if (!this.validateEmail(email)) {
      if (errorEl) {
        errorEl.textContent = `Please enter a valid ${this.config.emailDomain} email address`;
      }
      return;
    }

    // Clear error
    if (errorEl) errorEl.textContent = '';

    // Show loading state
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.classList.add('btn-loading');
      sendBtn.dataset.originalText = sendBtn.textContent;
      sendBtn.textContent = 'Sending...';
    }

    // Store email and send OTP
    this.state.currentEmail = email;
    const result = await this.sendOTP(email);

    // Reset button
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.classList.remove('btn-loading');
      sendBtn.textContent = sendBtn.dataset.originalText || 'Send OTP';
    }

    if (result.success) {
      // Show OTP step
      this.showStep('otp');
      // Focus first OTP input
      const firstOtpInput = document.querySelector('.otp-digit');
      if (firstOtpInput) firstOtpInput.focus();
      // Start resend countdown
      this.startResendCountdown();
    } else {
      if (errorEl) errorEl.textContent = result.message || 'Failed to send OTP';
    }
  },

  /**
   * Handle verify OTP button click
   */
  async handleVerifyOTP() {
    const otp = this.getOTPValue();
    const errorEl = document.getElementById('otp-error');
    const verifyBtn = document.getElementById('verify-otp-btn');

    if (otp.length !== this.config.otpLength) {
      if (errorEl) errorEl.textContent = 'Please enter the complete OTP';
      return;
    }

    // Clear error
    if (errorEl) errorEl.textContent = '';

    // Show loading state
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.classList.add('btn-loading');
      verifyBtn.textContent = 'Verifying...';
    }

    const result = await this.verifyOTP(otp);

    if (result.success) {
      // Redirect to dashboard
      window.location.href = 'dashboard.html';
    } else {
      // Reset button
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.classList.remove('btn-loading');
        verifyBtn.textContent = 'Verify';
      }
      if (errorEl) errorEl.textContent = result.message || 'Invalid OTP';
      this.clearOTPInputs();
    }
  },

  /**
   * Handle resend OTP
   */
  async handleResendOTP() {
    const resendBtn = document.getElementById('resend-otp-btn');
    if (resendBtn && resendBtn.disabled) return;

    this.clearOTPInputs();
    await this.sendOTP(this.state.currentEmail);
    this.startResendCountdown();
  },

  /**
   * Start resend countdown timer
   */
  startResendCountdown() {
    const resendBtn = document.getElementById('resend-otp-btn');
    if (!resendBtn) return;

    let seconds = this.config.otpResendDelay;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend in ${seconds}s`;

    const interval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(interval);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend OTP';
      } else {
        resendBtn.textContent = `Resend in ${seconds}s`;
      }
    }, 1000);
  },

  /**
   * Initialize dashboard functionality
   */
  initDashboard() {
    const copyBtn = document.getElementById('copy-invite-btn');
    const inviteInput = document.getElementById('invite-link-input');

    if (copyBtn && inviteInput) {
      // Generate and display invite link
      const inviteLink = this.generateInviteLink();
      if (inviteLink) {
        inviteInput.value = inviteLink;
      }

      // Copy button handler
      copyBtn.addEventListener('click', async () => {
        const success = await this.copyToClipboard(inviteInput.value);
        if (success) {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        }
      });
    }

    // Load team members
    this.loadTeamMembers();
  },

  /**
   * Check URL parameters for team join flow
   */
  checkURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const teamId = urlParams.get('t');

    if (teamId && window.location.pathname.includes('join.html')) {
      this.state.teamId = teamId;
      this.state.isTeamLeader = false;

      // Update UI to show team ID
      const teamIdDisplay = document.getElementById('join-team-id');
      if (teamIdDisplay) {
        teamIdDisplay.textContent = teamId;
      }
    }
  },

  /**
   * Save registration to localStorage
   */
  saveRegistration() {
    const registration = {
      email: this.state.currentEmail,
      teamId: this.state.teamId,
      isTeamLeader: this.state.isTeamLeader,
      timestamp: Date.now(),
    };
    localStorage.setItem('famhack_registration', JSON.stringify(registration));

    // Also save to team members list
    this.addTeamMember(registration);
  },

  /**
   * Get stored team ID
   */
  getStoredTeamId() {
    const stored = localStorage.getItem('famhack_registration');
    if (stored) {
      const data = JSON.parse(stored);
      return data.teamId;
    }
    return null;
  },

  /**
   * Get stored registration
   */
  getStoredRegistration() {
    const stored = localStorage.getItem('famhack_registration');
    return stored ? JSON.parse(stored) : null;
  },

  /**
   * Add team member to storage
   */
  addTeamMember(member) {
    const teamId = member.teamId;
    const teamKey = `famhack_team_${teamId}`;
    const existing = localStorage.getItem(teamKey);
    const members = existing ? JSON.parse(existing) : [];

    // Check if member already exists
    if (!members.find(m => m.email === member.email)) {
      members.push({
        email: member.email,
        isLeader: member.isTeamLeader,
        joinedAt: member.timestamp,
      });
      localStorage.setItem(teamKey, JSON.stringify(members));
    }
  },

  /**
   * Load team members for dashboard
   */
  loadTeamMembers() {
    const membersList = document.getElementById('members-list');
    if (!membersList) return;

    const teamId = this.getStoredTeamId();
    if (!teamId) return;

    const teamKey = `famhack_team_${teamId}`;
    const stored = localStorage.getItem(teamKey);
    const members = stored ? JSON.parse(stored) : [];

    // Clear existing
    membersList.innerHTML = '';

    if (members.length === 0) {
      membersList.innerHTML = '<p class="no-members">No team members yet. Share your invite link!</p>';
      return;
    }

    members.forEach(member => {
      const card = document.createElement('div');
      card.className = 'member-card';
      card.innerHTML = `
        <div class="member-info">
          <p class="member-email">${member.email}</p>
          <p class="member-role">${member.isLeader ? 'Team Leader' : 'Team Member'}</p>
        </div>
        <span class="member-status ${member.isLeader ? 'leader' : 'member'}">
          ${member.isLeader ? 'Leader' : 'Member'}
        </span>
      `;
      membersList.appendChild(card);
    });
  },

  /**
   * Check if user is registered
   */
  isRegistered() {
    return !!this.getStoredRegistration();
  },

  /**
   * Redirect to dashboard if already registered
   */
  redirectIfRegistered() {
    if (this.isRegistered() && !window.location.pathname.includes('dashboard.html')) {
      window.location.href = 'dashboard.html';
    }
  },

  /**
   * Initialize navigation flyout menu with GSAP animations
   */
  initNavigation() {
    const burger = document.querySelector('.nav-burger');
    const flyout = document.querySelector('.flyout-menu');
    const closeBtn = document.querySelector('.flyout-close');
    const backdrop = document.querySelector('.nav-blur');
    const closeClickArea = document.querySelector('.nav-close-click-area');
    const menuItems = flyout ? flyout.querySelectorAll('.menu-item') : [];
    const menuContent = flyout ? flyout.querySelector('.menu-content') : null;

    if (!burger || !flyout) return;

    // Check if GSAP is available
    const hasGSAP = typeof gsap !== 'undefined';

    // Create animation timeline
    let menuTimeline = null;

    const openMenu = () => {
      flyout.classList.add('is-open');
      document.body.classList.add('menu-open');

      if (hasGSAP) {
        // Kill any existing animation
        if (menuTimeline) menuTimeline.kill();

        menuTimeline = gsap.timeline();

        // Animate flyout sliding in from right
        menuTimeline.fromTo(flyout,
          { x: '100%', opacity: 0 },
          { x: '0%', opacity: 1, duration: 0.4, ease: 'power3.out' }
        );

        // Stagger menu items with a slide-up and fade-in effect
        if (menuItems.length > 0) {
          menuTimeline.fromTo(menuItems,
            { y: 40, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.35,
              stagger: 0.08,
              ease: 'power2.out'
            },
            '-=0.2' // Start slightly before flyout finishes
          );
        }

        // Animate menu content with subtle scale
        if (menuContent) {
          menuTimeline.fromTo(menuContent,
            { scale: 0.95 },
            { scale: 1, duration: 0.3, ease: 'power2.out' },
            0
          );
        }
      }
    };

    const closeMenu = () => {
      if (hasGSAP) {
        // Kill any existing animation
        if (menuTimeline) menuTimeline.kill();

        menuTimeline = gsap.timeline({
          onComplete: () => {
            flyout.classList.remove('is-open');
            document.body.classList.remove('menu-open');
            // Reset styles for next open
            gsap.set(flyout, { clearProps: 'all' });
            gsap.set(menuItems, { clearProps: 'all' });
            if (menuContent) gsap.set(menuContent, { clearProps: 'all' });
          }
        });

        // Fade out menu items quickly
        if (menuItems.length > 0) {
          menuTimeline.to(menuItems,
            {
              y: -20,
              opacity: 0,
              duration: 0.2,
              stagger: 0.03,
              ease: 'power2.in'
            }
          );
        }

        // Slide flyout out to right
        menuTimeline.to(flyout,
          { x: '100%', opacity: 0, duration: 0.35, ease: 'power3.in' },
          '-=0.1'
        );
      } else {
        flyout.classList.remove('is-open');
        document.body.classList.remove('menu-open');
      }
    };

    burger.addEventListener('click', openMenu);

    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    if (backdrop) backdrop.addEventListener('click', closeMenu);
    if (closeClickArea) closeClickArea.addEventListener('click', closeMenu);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && flyout.classList.contains('is-open')) {
        closeMenu();
      }
    });
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  FamHack.init();
});

// Export for use in other scripts
window.FamHack = FamHack;
