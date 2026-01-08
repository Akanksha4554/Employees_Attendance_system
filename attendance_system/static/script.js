// Global variables
let currentCamera = null;
let currentEmployeeId = '';
let registrationInProgress = false;

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('Face Attendance System Initialized');
    
    // Initialize tooltips
    initTooltips();
    
    // Initialize camera based on current page
    const path = window.location.pathname;
    
    if (path.includes('register')) {
        initializeRegistrationPage();
    } else if (path.includes('attendance')) {
        // Attendance page uses multi_face.js
        console.log('Attendance page - using multi_face.js');
    } else if (path.includes('logs')) {
        initializeLogsPage();
    }
    
    // Set current date
    updateCurrentDate();
    
    // Load employee count if on relevant page
    if (!path.includes('logs')) {
        loadEmployeeCount();
    }
});

// Tooltip initialization
function initTooltips() {
    const tooltips = document.querySelectorAll('[data-tooltip]');
    tooltips.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(event) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = event.target.dataset.tooltip;
    document.body.appendChild(tooltip);
    
    const rect = event.target.getBoundingClientRect();
    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 5}px`;
    tooltip.style.left = `${rect.left + (rect.width - tooltip.offsetWidth) / 2}px`;
}

function hideTooltip() {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// Registration page functions
async function initializeRegistrationPage() {
    try {
        currentCamera = await initializeCamera('register-video');
        if (currentCamera) {
            console.log('Registration camera ready');
            setupRegistrationForm();
        }
    } catch (error) {
        console.error('Failed to initialize registration camera:', error);
    }
}

function setupRegistrationForm() {
    // Employee ID validation
    const employeeIdInput = document.getElementById('employee_id');
    if (employeeIdInput) {
        employeeIdInput.addEventListener('input', debounce(checkEmployeeIdAvailability, 500));
    }
    
    // Name validation
    const nameInput = document.getElementById('name');
    if (nameInput) {
        nameInput.addEventListener('blur', validateName);
    }
    
    // Form submission
    const form = document.getElementById('registration-form');
    if (form) {
        form.addEventListener('submit', handleRegistrationSubmit);
    }
}

async function checkEmployeeIdAvailability() {
    const employeeIdInput = document.getElementById('employee_id');
    const feedback = document.getElementById('id-feedback');
    
    if (!employeeIdInput || !feedback) return;
    
    const employeeId = employeeIdInput.value.trim();
    
    if (employeeId.length < 3) {
        feedback.textContent = 'Employee ID must be at least 3 characters';
        feedback.className = 'form-feedback error';
        feedback.style.display = 'block';
        return;
    }
    
    // Check format (example: EMP001)
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(employeeId)) {
        feedback.textContent = 'Use only letters, numbers, hyphens, or underscores';
        feedback.className = 'form-feedback error';
        feedback.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/check_employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id: employeeId })
        });
        
        const data = await response.json();
        
        if (data.available) {
            feedback.textContent = '✓ Employee ID available';
            feedback.className = 'form-feedback success';
        } else {
            feedback.textContent = data.message || 'Employee ID already exists';
            feedback.className = 'form-feedback error';
        }
        feedback.style.display = 'block';
    } catch (error) {
        console.error('Error checking employee ID:', error);
        feedback.textContent = 'Error checking availability';
        feedback.className = 'form-feedback error';
        feedback.style.display = 'block';
    }
}

function validateName() {
    const nameInput = document.getElementById('name');
    const feedback = document.getElementById('name-feedback');
    
    if (!nameInput || !feedback) return;
    
    const name = nameInput.value.trim();
    
    if (name.length < 2) {
        feedback.textContent = 'Name must be at least 2 characters';
        feedback.className = 'form-feedback error';
        feedback.style.display = 'block';
        return false;
    }
    
    if (!/^[A-Za-z\s]{2,50}$/.test(name)) {
        feedback.textContent = 'Use only letters and spaces';
        feedback.className = 'form-feedback error';
        feedback.style.display = 'block';
        return false;
    }
    
    feedback.textContent = '✓ Valid name';
    feedback.className = 'form-feedback success';
    feedback.style.display = 'block';
    return true;
}

async function handleRegistrationSubmit(event) {
    event.preventDefault();
    
    if (registrationInProgress) {
        showNotification('Registration already in progress', 'error');
        return;
    }
    
    const employeeId = document.getElementById('employee_id').value.trim();
    const name = document.getElementById('name').value.trim();
    const department = document.getElementById('department').value.trim();
    const position = document.getElementById('position').value.trim();
    
    // Validate inputs
    if (!employeeId || !name) {
        showNotification('Employee ID and Name are required', 'error');
        return;
    }
    
    if (employeeId.length < 3) {
        showNotification('Employee ID must be at least 3 characters', 'error');
        return;
    }
    
    if (name.length < 2) {
        showNotification('Name must be at least 2 characters', 'error');
        return;
    }
    
    try {
        registrationInProgress = true;
        
        // Show loading
        showLoading('Capturing face and registering employee...');
        
        // Capture image
        if (!currentCamera) {
            throw new Error('Camera not initialized');
        }
        
        const imageData = currentCamera.captureImage();
        
        // Register employee
        const response = await fetch('/api/register_employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: employeeId,
                name: name,
                department: department,
                position: position,
                image: imageData
            })
        });
        
        const data = await response.json();
        
        hideLoading();
        
        if (data.success) {
            showRegistrationSuccess(data.message);
            resetRegistrationForm();
            updateEmployeeCount();
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Registration error:', error);
        hideLoading();
        showRegistrationError(error.message);
    } finally {
        registrationInProgress = false;
    }
}

function showRegistrationSuccess(message) {
    const resultDiv = document.getElementById('registration-result');
    if (resultDiv) {
        resultDiv.innerHTML = `
            <div class="success-card">
                <div class="success-icon">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h3>Registration Successful!</h3>
                <p>${message}</p>
                <div class="success-actions">
                    <button class="btn btn-success" onclick="resetRegistrationForm()">
                        <i class="fas fa-user-plus"></i> Register Another
                    </button>
                    <button class="btn btn-secondary" onclick="location.href='/attendance'">
                        <i class="fas fa-camera"></i> Mark Attendance
                    </button>
                </div>
            </div>
        `;
    }
    
    showNotification('Employee registered successfully!', 'success');
}

function showRegistrationError(message) {
    const resultDiv = document.getElementById('registration-result');
    if (resultDiv) {
        resultDiv.innerHTML = `
            <div class="error-card">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3>Registration Failed</h3>
                <p>${message}</p>
                <button class="btn btn-primary" onclick="retryRegistration()">
                    <i class="fas fa-redo"></i> Try Again
                </button>
            </div>
        `;
    }
    
    showNotification(`Registration failed: ${message}`, 'error');
}

function resetRegistrationForm() {
    const form = document.getElementById('registration-form');
    if (form) {
        form.reset();
    }
    
    const feedbacks = document.querySelectorAll('.form-feedback');
    feedbacks.forEach(fb => fb.style.display = 'none');
    
    const resultDiv = document.getElementById('registration-result');
    if (resultDiv) {
        resultDiv.innerHTML = '';
    }
}

function retryRegistration() {
    resetRegistrationForm();
    const resultDiv = document.getElementById('registration-result');
    if (resultDiv) {
        resultDiv.innerHTML = '';
    }
}

// Logs page functions
function initializeLogsPage() {
    // Load today's attendance
    loadTodayAttendance();
    
    // Load recent files
    loadRecentFiles();
    
    // Set default date range (last 7 days)
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    const startDate = document.getElementById('start-date');
    const endDate = document.getElementById('end-date');
    
    if (startDate && endDate) {
        startDate.value = weekAgoStr;
        endDate.value = today;
        startDate.max = today;
        endDate.max = today;
        endDate.min = weekAgoStr;
    }
    
    // Add date validation
    if (startDate) {
        startDate.addEventListener('change', function() {
            if (endDate && endDate.value < this.value) {
                endDate.value = this.value;
            }
            if (endDate) {
                endDate.min = this.value;
            }
        });
    }
}

async function loadTodayAttendance() {
    try {
        const response = await fetch('/api/today_attendance');
        const data = await response.json();
        
        if (data.success) {
            updateTodayAttendanceTable(data.records);
            updateTodayStats(data.records);
        }
    } catch (error) {
        console.error('Error loading today attendance:', error);
        showNotification('Error loading attendance data', 'error');
    }
}

function updateTodayAttendanceTable(records) {
    const tableBody = document.querySelector('#today-table tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (records.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-data">
                    <i class="fas fa-calendar-times"></i>
                    No attendance recorded today
                </td>
            </tr>
        `;
        return;
    }
    
    records.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${record.employee_id || ''}</td>
            <td>${record.name || ''}</td>
            <td>${formatTime(record.time_in)}</td>
            <td>${formatTime(record.time_out)}</td>
            <td><span class="status-badge status-present">Present</span></td>
        `;
        tableBody.appendChild(row);
    });
}

function updateTodayStats(records) {
    const presentCount = records.length;
    
    // Update present count
    const presentElement = document.getElementById('total-present');
    if (presentElement) {
        presentElement.textContent = presentCount;
    }
    
    // Load total employees for rate calculation
    loadEmployeeCount().then(total => {
        const rateElement = document.getElementById('attendance-rate');
        if (rateElement && total > 0) {
            const rate = Math.round((presentCount / total) * 100);
            rateElement.textContent = `${rate}%`;
        }
    });
}

async function loadRecentFiles() {
    try {
        // In a real app, you would fetch from an API endpoint
        const today = new Date();
        const files = [];
        
        // Generate last 5 days files
        for (let i = 0; i < 5; i++) {
            const date = new Date();
            date.setDate(today.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            files.push({
                name: `attendance_${dateStr}.xlsx`,
                date: dateStr,
                size: '~15KB',
                records: i === 0 ? 'Today' : `${Math.floor(Math.random() * 50) + 10} records`
            });
        }
        
        const fileList = document.getElementById('file-list');
        if (fileList) {
            fileList.innerHTML = files.map(file => `
                <div class="file-item">
                    <div class="file-icon">
                        <i class="fas fa-file-excel"></i>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${file.name}</div>
                        <div class="file-meta">
                            <span class="file-date">${file.date}</span>
                            <span class="file-size">${file.size}</span>
                            <span class="file-records">${file.records}</span>
                        </div>
                    </div>
                    <div class="file-actions">
                        <button class="btn-icon" onclick="downloadFile('${file.name}')" 
                                title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                        ${i === 0 ? `
                        <button class="btn-icon" onclick="viewFile('${file.name}')" 
                                title="View">
                            <i class="fas fa-eye"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading files:', error);
    }
}

// Utility functions
async function loadEmployeeCount() {
    try {
        const response = await fetch('/api/employees');
        const data = await response.json();
        
        if (data.success) {
            const countElement = document.getElementById('total-employees') || 
                                document.getElementById('total-employees-log');
            if (countElement) {
                countElement.textContent = data.total;
            }
            return data.total;
        }
        return 0;
    } catch (error) {
        console.error('Error loading employee count:', error);
        return 0;
    }
}

function updateCurrentDate() {
    const dateElements = document.querySelectorAll('.current-date');
    const today = new Date();
    const dateString = today.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    dateElements.forEach(el => {
        el.textContent = dateString;
    });
}

function formatTime(timeString) {
    if (!timeString) return '-';
    try {
        const time = new Date(`1970-01-01T${timeString}`);
        return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
        return timeString;
    }
}

function showLoading(message = 'Processing...') {
    const loadingDiv = document.getElementById('loading');
    if (loadingDiv) {
        loadingDiv.innerHTML = `
            <div class="loading-overlay">
                <div class="spinner"></div>
                <p>${message}</p>
            </div>
        `;
        loadingDiv.style.display = 'block';
    }
}

function hideLoading() {
    const loadingDiv = document.getElementById('loading');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 
                             type === 'error' ? 'exclamation-circle' : 
                             'info-circle'}"></i>
        </div>
        <div class="notification-content">
            <p>${message}</p>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.classList.add('fade-out');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, 5000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeRegistrationPage,
        checkEmployeeIdAvailability,
        validateName,
        handleRegistrationSubmit,
        loadEmployeeCount,
        formatTime,
        showNotification
    };
}