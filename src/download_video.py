import gdown
import os

# --- CẤU HÌNH ---
# ID lấy từ link drive của bạn
file_id = '1kI8J09w_DXwqv6nTWq1HpAM8Q2YdOFGD'

# Đường dẫn đích: static/info4.mp4
output_dir = 'static'
filename = 'info_forum.mp4'

def download_video():
    # Tạo đường dẫn đầy đủ
    output_path = os.path.join(output_dir, filename)

    # 1. Tạo thư mục static nếu chưa có
    os.makedirs(output_dir, exist_ok=True)

    # 2. Kiểm tra nếu file đã tồn tại thì thôi (để test ở máy local cho nhanh)
    if os.path.exists(output_path):
        print(f"✅ Video {filename} đã có sẵn trong {output_dir}. Bỏ qua tải.")
        return

    print(f"⬇️ Đang tải video {filename} từ Drive...")
    
    try:
        # Link tải trực tiếp của Google Drive
        url = f'https://drive.google.com/uc?id={file_id}'
        
        # Tải về (quiet=False để hiện thanh tiến trình)
        gdown.download(url, output_path, quiet=False)
        
        # Kiểm tra lại lần nữa cho chắc
        if os.path.exists(output_path):
            print("✅ Tải video thành công!")
        else:
            print("❌ Tải thất bại (File không thấy đâu).")
            
    except Exception as e:
        print(f"❌ Lỗi khi tải video: {e}")

if __name__ == "__main__":
    download_video()