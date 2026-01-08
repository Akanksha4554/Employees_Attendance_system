class MultiFaceAttendance {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.stream = null;
        this.isCameraActive = false;
        this.faceDetections = [];
    }
    
    async initializeCamera(videoElementId) {
        try {
            this.video = document.getElementById(videoElementId);
            
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'environment',
                    frameRate: { ideal: 30 }
                }
            };
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            this.isCameraActive = true;
            
            // Wait for video to be ready
            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.video.play();
                    resolve();
                };
            });
            
            return true;
        } catch (error) {
            console.error('Error accessing camera:', error);
            this.showError('Unable to access camera. Please check permissions.');
            return false;
        }
    }
    
    captureMultiFaceImage() {
        if (!this.isCameraActive) {
            throw new Error('Camera is not active');
        }
        
        // Create canvas with video dimensions
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        
        const context = this.canvas.getContext('2d');
        
        // Draw video frame to canvas
        context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        // Enhance image for better face detection
        this.enhanceImageQuality(context);
        
        return this.canvas.toDataURL('image/jpeg', 0.9);
    }
    
    enhanceImageQuality(context) {
        // Apply image processing for better face detection
        const imageData = context.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        
        // Increase contrast slightly
        const contrast = 1.1;
        const brightness = 5;
        
        for (let i = 0; i < data.length; i += 4) {
            // Adjust contrast
            data[i] = this.clamp((data[i] - 128) * contrast + 128 + brightness);
            data[i + 1] = this.clamp((data[i + 1] - 128) * contrast + 128 + brightness);
            data[i + 2] = this.clamp((data[i + 2] - 128) * contrast + 128 + brightness);
        }
        
        context.putImageData(imageData, 0, 0);
    }
    
    clamp(value) {
        return Math.max(0, Math.min(255, value));
    }
    
    showError(message) {
        const container = document.getElementById('camera-container');
        if (container) {
            container.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${message}</p>
                </div>
            `;
        }
    }
    
    showLoading(message = 'Processing...') {
        const resultDiv = document.getElementById('result');
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="loading-result">
                    <div class="spinner"></div>
                    <p>${message}</p>
                </div>
            `;
            resultDiv.style.display = 'block';
        }
    }
    
    displayResults(results) {
        const resultDiv = document.getElementById('result');
        if (!resultDiv) return;
        
        const { recognized_faces, total_faces_detected, attendance_records } = results;
        
        let html = `
            <div class="attendance-results">
                <h3><i class="fas fa-users"></i> Attendance Results</h3>
                <div class="summary">
                    <div class="summary-item">
                        <i class="fas fa-user-check"></i>
                        <span>Recognized: ${recognized_faces.length}</span>
                    </div>
                    <div class="summary-item">
                        <i class="fas fa-user-friends"></i>
                        <span>Total Faces: ${total_faces_detected}</span>
                    </div>
                </div>
        `;
        
        if (recognized_faces.length > 0) {
            html += `
                <div class="recognized-list">
                    <h4><i class="fas fa-id-card"></i> Recognized Employees:</h4>
                    <div class="employee-cards">
            `;
            
            recognized_faces.forEach((employee, index) => {
                html += `
                    <div class="employee-card">
                        <div class="employee-header">
                            <div class="employee-avatar">${employee.name.charAt(0)}</div>
                            <div class="employee-info">
                                <h5>${employee.name}</h5>
                                <p>ID: ${employee.employee_id}</p>
                                ${employee.department ? `<p class="dept">${employee.department}</p>` : ''}
                            </div>
                            <div class="confidence">
                                <div class="confidence-bar">
                                    <div class="confidence-fill" style="width: ${employee.similarity * 100}%"></div>
                                </div>
                                <span>${Math.round(employee.similarity * 100)}%</span>
                            </div>
                        </div>
                        <div class="attendance-time">
                            <i class="fas fa-clock"></i>
                            ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                    </div>
                `;
            });
            
            html += `</div></div>`;
        }
        
        if (total_faces_detected > recognized_faces.length) {
            const unrecognized = total_faces_detected - recognized_faces.length;
            html += `
                <div class="unrecognized-alert">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>${unrecognized} face(s) not recognized</span>
                </div>
            `;
        }
        
        html += `</div>`;
        
        resultDiv.innerHTML = html;
        resultDiv.style.display = 'block';
        
        // Scroll to results
        resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Global instance
let attendanceSystem = new MultiFaceAttendance();

// Initialize camera
async function initializeAttendanceCamera() {
    const success = await attendanceSystem.initializeCamera('attendance-video');
    if (success) {
        console.log('Camera initialized for attendance');
        document.getElementById('capture-btn').disabled = false;
    }
}

// Mark attendance for multiple faces
async function markAttendance() {
    try {
        // Show loading
        attendanceSystem.showLoading('Detecting faces and marking attendance...');
        
        // Capture image
        const imageData = attendanceSystem.captureMultiFaceImage();
        
        // Send to backend
        const response = await fetch('/api/mark_attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageData })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Display results
            attendanceSystem.displayResults(data);
            
            // Play success sound
            playSuccessSound();
            
            // Show success message
            showNotification('Attendance marked successfully!', 'success');
            
            // Update attendance count
            updateAttendanceCount();
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error marking attendance:', error);
        showNotification(`Error: ${error.message}`, 'error');
        
        const resultDiv = document.getElementById('result');
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="error-result">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Attendance Failed</h3>
                    <p>${error.message}</p>
                    <button onclick="markAttendance()" class="retry-btn">
                        <i class="fas fa-redo"></i> Try Again
                    </button>
                </div>
            `;
            resultDiv.style.display = 'block';
        }
    }
}

// Helper functions
function playSuccessSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQ=');
    audio.play().catch(e => console.log('Audio play failed:', e));
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

async function updateAttendanceCount() {
    try {
        const response = await fetch('/api/today_attendance');
        const data = await response.json();
        
        if (data.success) {
            const countElement = document.getElementById('today-count');
            if (countElement) {
                countElement.textContent = data.records.length;
            }
        }
    } catch (error) {
        console.error('Error updating count:', error);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('attendance-video')) {
        initializeAttendanceCamera();
    }
    
    // Update attendance count
    updateAttendanceCount();
});