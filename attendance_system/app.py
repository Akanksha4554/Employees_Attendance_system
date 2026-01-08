from flask import Flask, render_template, request, jsonify, redirect, url_for, send_file
import cv2, os, base64, numpy as np
from deepface import DeepFace
import uuid
import re
from datetime import datetime, date
import pandas as pd
from database import db, Employee, Attendance
from attendance_manager import AttendanceManager

app = Flask(__name__)
app.config['SECRET_KEY'] = 'attendance-system-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///face_attendance.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db.init_app(app)

# Initialize managers
FACE_FOLDER = "faces"
os.makedirs(FACE_FOLDER, exist_ok=True)

# Create attendance logs folder
attendance_logs_folder = "attendance_logs"
os.makedirs(attendance_logs_folder, exist_ok=True)

# In-memory storage for quick access
employees_cache = {}

# Initialize database FIRST
with app.app_context():
    db.create_all()
    print("Database tables created successfully!")

# Then initialize AttendanceManager AFTER db is created
attendance_manager = AttendanceManager()

def decode_image(data):
    """Convert base64 image to OpenCV format"""
    try:
        if ',' in data:
            header, encoded = data.split(',', 1)
        else:
            encoded = data
        img = base64.b64decode(encoded)
        npimg = np.frombuffer(img, np.uint8)
        return cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

def extract_face_embedding(image_path):
    """Extract face embedding using DeepFace"""
    try:
        embedding = DeepFace.represent(
            img_path=image_path,
            model_name="Facenet",
            enforce_detection=True,
            detector_backend="mtcnn"
        )
        return embedding[0]['embedding']
    except Exception as e:
        print(f"Error extracting embedding: {e}")
        return None

def extract_multiple_faces_embeddings(image_path):
    """Extract embeddings for all faces in image"""
    try:
        embeddings_data = DeepFace.represent(
            img_path=image_path,
            model_name="Facenet",
            enforce_detection=False,
            detector_backend="mtcnn"
        )
        
        if isinstance(embeddings_data, list):
            embeddings = []
            for face_data in embeddings_data:
                if 'embedding' in face_data:
                    embeddings.append(face_data['embedding'])
            return embeddings
        return None
    except Exception as e:
        print(f"Error extracting multiple faces: {e}")
        return None

def sanitize_filename(name):
    """Sanitize name for filename use"""
    sanitized = re.sub(r'[^\w\s-]', '', name)
    sanitized = re.sub(r'[-\s]+', '_', sanitized)
    return sanitized.lower()

def load_employees_to_cache():
    """Load all employees into cache for quick access"""
    global employees_cache
    employees_cache = {}
    
    try:
        employees = Employee.query.all()
        for emp in employees:
            if emp.face_encoding_path and os.path.exists(emp.face_encoding_path):
                try:
                    embedding = np.load(emp.face_encoding_path)
                    employees_cache[emp.employee_id] = {
                        'employee_id': emp.employee_id,
                        'name': emp.name,
                        'department': emp.department,
                        'position': emp.position,
                        'embedding': embedding
                    }
                except Exception as e:
                    print(f"Error loading embedding for {emp.employee_id}: {e}")
        
        print(f"Loaded {len(employees_cache)} employees to cache")
    except Exception as e:
        print(f"Error loading employees to cache: {e}")

def compare_faces(new_embeddings, threshold=0.65):
    """Compare new embeddings with all registered faces"""
    matches = []
    
    for new_embedding in new_embeddings:
        best_match = None
        best_similarity = 0
        
        for emp_id, emp_data in employees_cache.items():
            saved_embedding = emp_data['embedding']
            
            # Calculate cosine similarity
            similarity = np.dot(new_embedding, saved_embedding) / (
                np.linalg.norm(new_embedding) * np.linalg.norm(saved_embedding)
            )
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = {
                    'employee_id': emp_id,
                    'name': emp_data['name'],
                    'similarity': float(similarity),
                    'department': emp_data.get('department', ''),
                    'position': emp_data.get('position', '')
                }
        
        # Only accept if similarity is above threshold
        if best_match and best_match['similarity'] > threshold:
            matches.append(best_match)
    
    return matches

@app.route('/')
def index():
    return redirect(url_for('attendance_page'))

@app.route('/register')
def register_page():
    return render_template('register.html')

@app.route('/attendance')
def attendance_page():
    return render_template('attendance.html')

@app.route('/logs')
def logs_page():
    return render_template('logs.html')

@app.route('/success')
def success_page():
    return render_template('success.html')

@app.route('/api/check_employee', methods=['POST'])
def check_employee():
    """Check if employee ID is available"""
    try:
        data = request.json
        employee_id = data.get('employee_id', '').strip()
        
        if not employee_id:
            return jsonify({'available': False, 'message': 'Employee ID required'})
        
        existing = Employee.query.filter_by(employee_id=employee_id).first()
        if existing:
            return jsonify({'available': False, 'message': 'Employee ID already exists'})
        
        return jsonify({'available': True, 'message': 'Employee ID available'})
    except Exception as e:
        return jsonify({'available': False, 'message': str(e)})

@app.route('/api/register_employee', methods=['POST'])
def register_employee():
    """Register new employee with face"""
    try:
        data = request.json
        employee_id = data.get('employee_id', '').strip()
        name = data.get('name', '').strip()
        department = data.get('department', '').strip()
        position = data.get('position', '').strip()
        image_data = data.get('image', '')
        
        # Validate
        if not all([employee_id, name, image_data]):
            return jsonify({'success': False, 'message': 'Missing required fields'})
        
        # Check if employee exists
        existing = Employee.query.filter_by(employee_id=employee_id).first()
        if existing:
            return jsonify({'success': False, 'message': 'Employee ID already exists'})
        
        # Decode and save image
        frame = decode_image(image_data)
        if frame is None:
            return jsonify({'success': False, 'message': 'Invalid image'})
        
        # Save face image
        sanitized_name = sanitize_filename(name)
        face_filename = f"{employee_id}_{sanitized_name}.jpg"
        face_path = os.path.join(FACE_FOLDER, face_filename)
        
        counter = 1
        while os.path.exists(face_path):
            face_filename = f"{employee_id}_{sanitized_name}_{counter}.jpg"
            face_path = os.path.join(FACE_FOLDER, face_filename)
            counter += 1
        
        cv2.imwrite(face_path, frame)
        
        # Extract face embedding
        embedding = extract_face_embedding(face_path)
        if embedding is None:
            if os.path.exists(face_path):
                os.remove(face_path)
            return jsonify({
                'success': False, 
                'message': 'No face detected. Please ensure face is clearly visible.'
            })
        
        # Save embedding
        embedding_filename = f"{employee_id}_{sanitized_name}.npy"
        embedding_path = os.path.join(FACE_FOLDER, embedding_filename)
        
        counter = 1
        while os.path.exists(embedding_path):
            embedding_filename = f"{employee_id}_{sanitized_name}_{counter}.npy"
            embedding_path = os.path.join(FACE_FOLDER, embedding_filename)
            counter += 1
        
        np.save(embedding_path, embedding)
        
        # Create new employee in database
        new_employee = Employee(
            employee_id=employee_id,
            name=name,
            department=department,
            position=position,
            face_image_path=face_path,
            face_encoding_path=embedding_path,
            registered_at=datetime.now()
        )
        
        db.session.add(new_employee)
        db.session.commit()
        
        # Update cache
        employees_cache[employee_id] = {
            'employee_id': employee_id,
            'name': name,
            'department': department,
            'position': position,
            'embedding': embedding
        }
        
        print(f"Registered employee: {name} ({employee_id})")
        print(f"Total employees: {len(employees_cache)}")
        
        return jsonify({
            'success': True,
            'message': f'Employee {name} registered successfully!'
        })
        
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({'success': False, 'message': f'Registration failed: {str(e)}'})

@app.route('/api/mark_attendance', methods=['POST'])
def mark_attendance():
    """Mark attendance for multiple faces at once"""
    try:
        data = request.json
        image_data = data.get('image', '')
        
        if not image_data:
            return jsonify({'success': False, 'message': 'No image provided'})
        
        # Decode image
        frame = decode_image(image_data)
        if frame is None:
            return jsonify({'success': False, 'message': 'Invalid image'})
        
        # Save temporary image
        temp_filename = f"temp_{uuid.uuid4().hex[:8]}.jpg"
        temp_path = os.path.join(FACE_FOLDER, temp_filename)
        cv2.imwrite(temp_path, frame)
        
        # Extract all faces embeddings
        embeddings = extract_multiple_faces_embeddings(temp_path)
        
        if not embeddings:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return jsonify({
                'success': False, 
                'message': 'No faces detected. Please ensure faces are visible.'
            })
        
        print(f"Detected {len(embeddings)} faces in the image")
        
        # Compare with registered employees
        matches = compare_faces(embeddings, threshold=0.65)
        
        # Remove duplicates
        unique_matches = []
        seen_ids = set()
        for match in matches:
            if match['employee_id'] not in seen_ids:
                seen_ids.add(match['employee_id'])
                unique_matches.append(match)
        
        # Mark attendance for recognized employees
        attendance_records = []
        if unique_matches:
            attendance_data = []
            for match in unique_matches:
                attendance_data.append({
                    'employee_id': match['employee_id'],
                    'name': match['name'],
                    'department': match.get('department', ''),
                    'position': match.get('position', '')
                })
            
            # Mark attendance
            attendance_records = attendance_manager.mark_attendance(attendance_data)
        
        # Clean up
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        # Prepare response
        recognized = len(unique_matches)
        total_faces = len(embeddings)
        
        return jsonify({
            'success': True,
            'message': f'Attendance marked for {recognized} out of {total_faces} faces',
            'recognized_faces': unique_matches,
            'total_faces_detected': total_faces,
            'attendance_records': attendance_records
        })
        
    except Exception as e:
        print(f"Attendance marking error: {e}")
        return jsonify({'success': False, 'message': f'Attendance failed: {str(e)}'})

@app.route('/api/today_attendance')
def get_today_attendance():
    """Get today's attendance records"""
    try:
        records = attendance_manager.get_today_attendance()
        return jsonify({
            'success': True,
            'records': records,
            'date': date.today().isoformat()
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/download_today_attendance')
def download_today_attendance():
    """Download today's attendance as Excel"""
    try:
        today = date.today()
        excel_filename = f"attendance_{today.strftime('%Y-%m-%d')}.xlsx"
        excel_path = os.path.join(attendance_logs_folder, excel_filename)
        
        if os.path.exists(excel_path):
            return send_file(
                excel_path,
                as_attachment=True,
                download_name=excel_filename,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        else:
            return jsonify({'success': False, 'message': 'No attendance records for today'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/list_attendance_files')
def list_attendance_files():
    """List all available attendance Excel files"""
    try:
        files = []
        if os.path.exists(attendance_logs_folder):
            for filename in os.listdir(attendance_logs_folder):
                if filename.endswith('.xlsx'):
                    filepath = os.path.join(attendance_logs_folder, filename)
                    if os.path.isfile(filepath):
                        files.append({
                            'filename': filename,
                            'path': filepath,
                            'size': os.path.getsize(filepath),
                            'modified': os.path.getmtime(filepath)
                        })
        
        # Sort by filename (which contains date) descending
        files.sort(key=lambda x: x['filename'], reverse=True)
        
        return jsonify({
            'success': True,
            'files': files,
            'count': len(files)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/download_attendance_file/<filename>')
def download_attendance_file(filename):
    """Download specific attendance Excel file"""
    try:
        # Security check: prevent directory traversal
        if '..' in filename or filename.startswith('/'):
            return jsonify({'success': False, 'message': 'Invalid filename'})
        
        filepath = os.path.join(attendance_logs_folder, filename)
        
        if os.path.exists(filepath) and filename.endswith('.xlsx'):
            return send_file(
                filepath,
                as_attachment=True,
                download_name=filename,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        else:
            return jsonify({'success': False, 'message': 'File not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/employees')
def get_employees():
    """Get list of all registered employees"""
    try:
        employees = Employee.query.all()
        employee_list = []
        for emp in employees:
            employee_list.append({
                'employee_id': emp.employee_id,
                'name': emp.name,
                'department': emp.department,
                'position': emp.position,
                'registered_at': emp.registered_at.strftime('%Y-%m-%d %H:%M:%S') if emp.registered_at else ''
            })
        
        return jsonify({
            'success': True,
            'employees': employee_list,
            'total': len(employee_list)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/init_database')
def init_database():
    """Initialize database (for testing)"""
    try:
        with app.app_context():
            db.create_all()
            load_employees_to_cache()
        return jsonify({'success': True, 'message': 'Database initialized successfully'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# Initialize database and load cache
with app.app_context():
    load_employees_to_cache()

if __name__ == "__main__":
    print("\n" + "="*50)
    print("MULTI-FACE ATTENDANCE SYSTEM")
    print("="*50)
    print(f"Loaded Employees: {len(employees_cache)}")
    print(f"Faces Folder: {FACE_FOLDER}")
    print(f"Attendance Logs: {attendance_logs_folder}")
    print("="*50)
    print("\nStarting server...")
    
    app.run(debug=True, host='0.0.0.0', port=5000)