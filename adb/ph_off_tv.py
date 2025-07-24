import subprocess

# IP TV kamu (ganti sesuai alamat IP-nya)
tv_ip = "192.168.200.226"

def connect_to_tv(ip):
    result = subprocess.run(["adb", "connect", ip], capture_output=True, text=True)
    print(result.stdout)

def sleep_tv():
    result = subprocess.run(["adb", "shell", "input", "keyevent", "223"], capture_output=True, text=True)
    print("Layar dimatikan (sleep mode).")

def wakeup_tv():
    result = subprocess.run(["adb", "shell", "input", "keyevent", "224"], capture_output=True, text=True)
    print("Layar dinyalakan (wakeup mode).")    

# Menu interaktif
if __name__ == "__main__":
    connect_to_tv(f"{tv_ip}:5555")
    while True:
        print("\nPilih aksi:")
        print("1. Matikan layar (sleep mode)")
        print("2. Nyalakan layar (wakeup mode)")
        print("3. Keluar")
        pilihan = input("Masukkan pilihan (1/2/3): ")
        if pilihan == "1":
            sleep_tv()
        elif pilihan == "2":
            wakeup_tv()
        elif pilihan == "3":
            print("Keluar dari program.")
            break
        else:
            print("Pilihan tidak valid.")