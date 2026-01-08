import pandas as pd
import os
from datetime import datetime, date
import sqlite3
import openpyxl

class AttendanceManager:
    def __init__(self):
        self.db_path = 'face_attendance.db'
        self.attendance_folder = "attendance_logs"
        os.makedirs(self.attendance_folder, exist_ok=True)
        
        # Initialize database connection
        self.init_database()
    
    def init_database(self):
        """Initialize SQLite database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create attendance table if not exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id TEXT NOT NULL,
                name TEXT NOT NULL,
                date DATE NOT NULL,
                time_in TIME NOT NULL,
                time_out TIME,
                status TEXT DEFAULT 'Present',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(employee_id, date, time_in)
            )
        ''')
        
        conn.commit()
        conn.close()
        print("Database initialized successfully")
    
    def mark_attendance(self, employee_data_list):
        """Mark attendance for multiple employees at once (Punch In/Out system)"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        today = date.today()
        current_time = datetime.now().time()
        
        attendance_records = []
        
        for emp in employee_data_list:
            # Check if employee has attendance today
            cursor.execute('''
                SELECT id, time_in, time_out 
                FROM attendance 
                WHERE employee_id = ? AND date = ?
                ORDER BY created_at DESC
                LIMIT 1
            ''', (emp['employee_id'], today.isoformat()))
            
            existing = cursor.fetchone()
            
            if existing:
                attendance_id, time_in, time_out = existing
                
                if time_out is None:
                    # Has time_in but no time_out → Update time_out (Punch Out)
                    cursor.execute('''
                        UPDATE attendance 
                        SET time_out = ?
                        WHERE id = ?
                    ''', (current_time.isoformat(), attendance_id))
                    
                    attendance_records.append({
                        'employee_id': emp['employee_id'],
                        'name': emp['name'],
                        'date': today.strftime('%Y-%m-%d'),
                        'time_in': time_in,
                        'time_out': current_time.strftime('%H:%M:%S'),
                        'status': 'Present'
                    })
                    print(f"✓ {emp['name']} punched OUT at {current_time.strftime('%H:%M:%S')}")
                else:
                    # Has both time_in and time_out → Create new entry (Punch In for next session)
                    cursor.execute('''
                        INSERT INTO attendance 
                        (employee_id, name, date, time_in, status)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (
                        emp['employee_id'],
                        emp['name'],
                        today.isoformat(),
                        current_time.isoformat(),
                        'Present'
                    ))
                    
                    attendance_records.append({
                        'employee_id': emp['employee_id'],
                        'name': emp['name'],
                        'date': today.strftime('%Y-%m-%d'),
                        'time_in': current_time.strftime('%H:%M:%S'),
                        'time_out': None,
                        'status': 'Present'
                    })
                    print(f"✓ {emp['name']} punched IN at {current_time.strftime('%H:%M:%S')}")
            else:
                # No attendance today → Create new entry (Punch In)
                cursor.execute('''
                    INSERT INTO attendance 
                    (employee_id, name, date, time_in, status)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    emp['employee_id'],
                    emp['name'],
                    today.isoformat(),
                    current_time.isoformat(),
                    'Present'
                ))
                
                attendance_records.append({
                    'employee_id': emp['employee_id'],
                    'name': emp['name'],
                    'date': today.strftime('%Y-%m-%d'),
                    'time_in': current_time.strftime('%H:%M:%S'),
                    'time_out': None,
                    'status': 'Present'
                })
                print(f"✓ {emp['name']} punched IN at {current_time.strftime('%H:%M:%S')}")
        
        conn.commit()
        conn.close()
        
        # Save to Excel (only if we have records)
        if attendance_records:
            self.save_to_excel()
        
        return attendance_records
    
    def save_to_excel(self):
        """Save ALL today's attendance records to Excel file (clean format)"""
        conn = sqlite3.connect(self.db_path)
        
        today = date.today()
        excel_filename = f"attendance_{today.strftime('%Y-%m-%d')}.xlsx"
        excel_path = os.path.join(self.attendance_folder, excel_filename)
        
        try:
            # Get all attendance for today
            query = '''
                SELECT 
                    employee_id,
                    name,
                    date,
                    time(time_in) as time_in,
                    time(time_out) as time_out,
                    status
                FROM attendance 
                WHERE date = ?
                ORDER BY employee_id, time_in
            '''
            
            df = pd.read_sql_query(query, conn, params=(today.isoformat(),))
            
            # Format time columns
            if not df.empty:
                # Convert to string for Excel formatting
                df['time_in'] = pd.to_datetime(df['time_in']).dt.strftime('%H:%M:%S')
                df['time_out'] = pd.to_datetime(df['time_out']).dt.strftime('%H:%M:%S').replace('NaT', '')
                
                # Calculate duration if both times exist
                mask = df['time_out'].notna() & df['time_out'].ne('')
                df.loc[mask, 'duration'] = pd.to_timedelta(df.loc[mask, 'time_out']) - pd.to_timedelta(df.loc[mask, 'time_in'])
                df['duration'] = df['duration'].apply(lambda x: str(x).split()[-1] if pd.notna(x) else '')
            
            # Save to Excel
            with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Attendance', index=False)
                
                # Auto-adjust column widths
                worksheet = writer.sheets['Attendance']
                column_widths = {
                    'A': 15,  # employee_id
                    'B': 25,  # name
                    'C': 12,  # date
                    'D': 12,  # time_in
                    'E': 12,  # time_out
                    'F': 12,  # status
                    'G': 12   # duration
                }
                
                for col, width in column_widths.items():
                    worksheet.column_dimensions[col].width = width
                
                # Add header style
                header_row = worksheet[1]
                for cell in header_row:
                    cell.font = openpyxl.styles.Font(bold=True)
                    cell.alignment = openpyxl.styles.Alignment(horizontal='center')
            
            print(f"✓ Excel file saved: {excel_path}")
            
        except Exception as e:
            print(f"Error saving to Excel: {e}")
        finally:
            conn.close()
        
        return excel_path
    
    def get_today_attendance(self):
        """Get today's attendance records from Excel file"""
        today = date.today()
        excel_filename = f"attendance_{today.strftime('%Y-%m-%d')}.xlsx"
        excel_path = os.path.join(self.attendance_folder, excel_filename)
        
        if os.path.exists(excel_path):
            try:
                df = pd.read_excel(excel_path)
                return df.to_dict('records')
            except Exception as e:
                print(f"Error reading Excel file: {e}")
                return []
        return []
    
    def get_all_attendance(self, start_date=None, end_date=None):
        """Get attendance records for a date range"""
        conn = sqlite3.connect(self.db_path)
        
        try:
            if start_date and end_date:
                query = '''
                    SELECT 
                        employee_id,
                        name,
                        date,
                        time(time_in) as time_in,
                        time(time_out) as time_out,
                        status
                    FROM attendance 
                    WHERE date BETWEEN ? AND ?
                    ORDER BY date DESC, employee_id, time_in
                '''
                df = pd.read_sql_query(query, conn, params=(start_date, end_date))
            else:
                query = '''
                    SELECT 
                        employee_id,
                        name,
                        date,
                        time(time_in) as time_in,
                        time(time_out) as time_out,
                        status
                    FROM attendance 
                    ORDER BY date DESC, employee_id, time_in
                '''
                df = pd.read_sql_query(query, conn)
            
            return df.to_dict('records')
        except Exception as e:
            print(f"Error getting attendance: {e}")
            return []
        finally:
            conn.close()