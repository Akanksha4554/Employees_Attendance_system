// Camera management for registration page
class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
    }
    
    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });
            
            if (this.videoElement) {
                this.videoElement.srcObject = this.stream;
            }
            
            return true;
        } catch (error) {
            console.error('Camera error:', error);
            return false;
        }
    }
    
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }
    
    capture() {
        if (!this.videoElement) return null;
        
        const canvas = document.createElement('canvas');
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        
        const context = canvas.getContext('2d');
        context.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
        
        return canvas.toDataURL('image/jpeg', 0.9);
    }
}

// Global camera instance
let registrationCamera = null;

// Initialize registration camera
async function initializeRegistrationCamera() {
    registrationCamera = new CameraManager('register-video');
    const success = await registrationCamera.start();
    
    if (!success) {
        alert('Please allow camera access for registration');
        return false;
    }
    
    return true;
}

// Initialize attendance camera
async function initializeAttendanceCamera() {
    const video = document.getElementById('attendance-video');
    if (!video) return false;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'environment'
            }
        });
        
        video.srcObject = stream;
        return true;
    } catch (error) {
        console.error('Attendance camera error:', error);
        return false;
    }
}

// Capture image for attendance
function captureAttendanceImage() {
    const video = document.getElementById('attendance-video');
    if (!video) return null;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.9);
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CameraManager,
        initializeRegistrationCamera,
        initializeAttendanceCamera,
        captureAttendanceImage
    };
}