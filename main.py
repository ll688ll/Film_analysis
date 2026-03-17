VERSION = "1.0.0"

import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter import ttk
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure
import matplotlib.patches as patches
import json
import os
import sys
from scipy.optimize import curve_fit
from matplotlib.widgets import RectangleSelector, EllipseSelector
from matplotlib.path import Path
from matplotlib.transforms import Affine2D

# --- Model / Logic ---

def rational_func_calibration(pixel_val, a, b, c):
    """
    Calculates dose from pixel value using the user-provided rational function:
    Dose = b / (color_percentage - a) + c
    where color_percentage = pixel_val / 255.0
    """
    color_percentage = pixel_val.astype(float) / 255.0
    
    # Avoid division by zero
    denominator = color_percentage - a
    
    # Mask out zeroes or very small values to avoid inf where denominator is 0
    # We use np.divide with 'where' to handle safe division
    term1 = np.divide(b, denominator, out=np.zeros_like(denominator), where=denominator!=0)
    
    return term1 + c

def rational_color_model(dose, a, b, c):
    """Color% = a + b / (Dose - c) — forward model for curve fitting."""
    return a + b / (dose - c)

class FilmAnalyzer:
    def __init__(self):
        self.image_array = None  # RGB or Grayscale
        self.dose_map = None
        self.dpi = 72.0  # Default
        
    def load_image(self, filepath):
        img = Image.open(filepath)
        self.image_array = np.array(img)
        # Try to guess DPI from metadata if available
        if 'dpi' in img.info:
            self.dpi = img.info['dpi'][0]
        return self.image_array

    def calculate_dose_map(self, channel, a, b, c):
        """
        Calculates the dose map using the specific channel (0=R,1=G,2=B) or 'gray'.
        """
        if self.image_array is None:
            raise ValueError("No image loaded")

        if self.image_array.ndim == 2:
            # Grayscale image
            arr = self.image_array.astype(float)
        else:
            # Color image
            if channel == 'Green':
                arr = self.image_array[:, :, 1].astype(float)
            elif channel == 'Red':
                arr = self.image_array[:, :, 0].astype(float)
            elif channel == 'Blue':
                arr = self.image_array[:, :, 2].astype(float)
            else: # Gray/Mix
                arr = np.mean(self.image_array, axis=2).astype(float)

        self.dose_map = rational_func_calibration(arr, a, b, c)
        return self.dose_map

    def get_roi_stats(self, roi_mask):
        if self.dose_map is None:
            return None
        
        # Apply mask
        masked_dose = self.dose_map[roi_mask]
        
        if masked_dose.size == 0:
            return None
        
        # # get the set of unique values in the masked dose
        # unique_dose = np.unique(masked_dose)

        # # get the 2% of the unique values
        # unique_dose_2_percent = unique_dose[int(len(unique_dose) * 0.01):int(len(unique_dose) * 0.99)]

        # sort the dose values
        sorted_dose = np.sort(masked_dose.flatten())
        
        # get the 2% of the sorted dose values
        unique_dose_2_percent = sorted_dose[int(len(sorted_dose) * 0.01):int(len(sorted_dose) * 0.99)]

        # get the max and min of the unique values
        trimmed_max_dose = np.max(unique_dose_2_percent)
        trimmed_min_dose = np.min(unique_dose_2_percent)

        # mean 
        mean_dose = np.mean(unique_dose_2_percent)
        # std
        std_dose = np.std(unique_dose_2_percent)
        # Coefficient of Variation (CV)
        cv_dose = std_dose / mean_dose * 100
        # flatness
        flatness = (trimmed_max_dose - trimmed_min_dose) / (trimmed_max_dose + trimmed_min_dose) * 100 if trimmed_min_dose != 0 else float('inf')

        return {
            "max": trimmed_max_dose,
            "min": trimmed_min_dose,
            "mean": mean_dose,
            "std": std_dose,
            "cv": cv_dose,
            "dur": trimmed_max_dose / trimmed_min_dose if trimmed_min_dose != 0 else float('inf'),
            "flatness": flatness
        }

# --- Calibration Wizard ---

class CalibrationWizard(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent_app = parent
        self.title("Calibration Wizard")
        self.geometry("1200x800")

        self.calibration_points = []  # list of {dose, red_pct, green_pct, blue_pct, filename}
        self.fitted_params = None  # {Red: {a,b,c}, Green: {a,b,c}, Blue: {a,b,c}}
        self.current_image_array = None
        self.current_filepath = None

        self._setup_ui()

    def _setup_ui(self):
        # Left control panel
        control_frame = ttk.Frame(self, padding="10")
        control_frame.pack(side=tk.LEFT, fill=tk.Y)

        # Profile name
        ttk.Label(control_frame, text="Profile Name:").pack(anchor='w')
        self.profile_name_var = tk.StringVar(value="New Calibration")
        ttk.Entry(control_frame, textvariable=self.profile_name_var, width=30).pack(fill=tk.X, pady=2)

        # Note
        ttk.Label(control_frame, text="Note:").pack(anchor='w')
        self.note_text = tk.Text(control_frame, height=3, width=30)
        self.note_text.pack(fill=tk.X, pady=2)

        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=5)

        # Load image
        ttk.Button(control_frame, text="Load Film Image", command=self._load_image).pack(fill=tk.X, pady=2)
        self.image_label = ttk.Label(control_frame, text="No image loaded", wraplength=200)
        self.image_label.pack(pady=2)

        # Dose entry
        dose_frame = ttk.Frame(control_frame)
        dose_frame.pack(fill=tk.X, pady=2)
        ttk.Label(dose_frame, text="Dose (Gy):").pack(side=tk.LEFT)
        self.dose_var = tk.StringVar(value="0.0")
        ttk.Entry(dose_frame, textvariable=self.dose_var, width=10).pack(side=tk.RIGHT)

        # Add point button
        ttk.Button(control_frame, text="Add Point from ROI", command=self._add_point).pack(fill=tk.X, pady=5)

        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=5)

        # Points table
        ttk.Label(control_frame, text="Calibration Points:").pack(anchor='w')
        columns = ("#", "Dose", "Red%", "Green%", "Blue%", "File")
        self.tree = ttk.Treeview(control_frame, columns=columns, show='headings', height=8)
        for col in columns:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=50 if col == "#" else 60)
        self.tree.column("File", width=80)
        self.tree.pack(fill=tk.X, pady=2)

        ttk.Button(control_frame, text="Remove Selected", command=self._remove_point).pack(fill=tk.X, pady=2)

        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=5)

        # Fit button
        ttk.Button(control_frame, text="Fit Curves", command=self._fit_curves).pack(fill=tk.X, pady=5)

        # Results display
        self.results_text = tk.Text(control_frame, height=10, width=30)
        self.results_text.pack(fill=tk.X, pady=2)

        # Primary channel selector
        ch_frame = ttk.Frame(control_frame)
        ch_frame.pack(fill=tk.X, pady=2)
        ttk.Label(ch_frame, text="Primary Channel:").pack(side=tk.LEFT)
        self.primary_channel_var = tk.StringVar(value="Red")
        ttk.Combobox(ch_frame, textvariable=self.primary_channel_var,
                      values=["Red", "Green", "Blue"], width=8).pack(side=tk.RIGHT)

        # Save button
        ttk.Button(control_frame, text="Save as Profile", command=self._save_profile).pack(fill=tk.X, pady=5)

        # Right panel — matplotlib
        display_frame = ttk.Frame(self, padding="10")
        display_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        self.figure = Figure(figsize=(7, 7), dpi=100)
        self.ax_image = self.figure.add_subplot(211)
        self.ax_curve = self.figure.add_subplot(212)
        self.ax_image.set_title("Film Image (draw ROI)")
        self.ax_curve.set_title("Calibration Curve")
        self.ax_curve.set_xlabel("Dose (Gy)")
        self.ax_curve.set_ylabel("Color %")
        self.ax_curve.grid(True, alpha=0.3)
        self.figure.tight_layout()

        self.canvas = FigureCanvasTkAgg(self.figure, master=display_frame)
        self.canvas.draw()
        self.canvas.get_tk_widget().pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        toolbar = NavigationToolbar2Tk(self.canvas, display_frame)
        toolbar.update()

        # ROI selector on image axes
        self.rect_selector = RectangleSelector(
            self.ax_image, lambda eclick, erelease: None,
            interactive=True, useblit=True, button=[1],
            props=dict(facecolor='cyan', edgecolor='cyan', alpha=0.3, fill=True)
        )

    def _load_image(self):
        path = filedialog.askopenfilename(
            parent=self,
            filetypes=[("Images", "*.tif;*.png;*.jpg;*.jpeg")])
        if not path:
            return
        try:
            img = Image.open(path)
            self.current_image_array = np.array(img)
            self.current_filepath = path
            self.image_label.config(text=os.path.basename(path))

            # Deactivate old selector before clearing axes
            self.rect_selector.set_active(False)
            self.rect_selector.disconnect_events()

            self.ax_image.clear()
            self.ax_image.set_title("Film Image (draw ROI)")
            if self.current_image_array.ndim == 2:
                self.ax_image.imshow(self.current_image_array, cmap='gray')
            else:
                self.ax_image.imshow(self.current_image_array)

            # Recreate selector on refreshed axes
            self.rect_selector = RectangleSelector(
                self.ax_image, lambda eclick, erelease: None,
                interactive=True, useblit=True, button=[1],
                props=dict(facecolor='cyan', edgecolor='cyan', alpha=0.3, fill=True)
            )
            self.canvas.draw()
        except Exception as e:
            messagebox.showerror("Error", f"Failed to load image: {e}")

    def _add_point(self):
        if self.current_image_array is None:
            messagebox.showwarning("No Image", "Load a film image first.")
            return

        # Get ROI from selector
        extents = self.rect_selector.extents  # xmin, xmax, ymin, ymax
        xmin, xmax, ymin, ymax = [int(round(v)) for v in extents]

        if xmin == xmax or ymin == ymax:
            messagebox.showwarning("No ROI", "Draw a rectangle ROI on the image first.")
            return

        # Clamp to image bounds
        h_img, w_img = self.current_image_array.shape[:2]
        xmin = max(0, min(xmin, w_img - 1))
        xmax = max(0, min(xmax, w_img))
        ymin = max(0, min(ymin, h_img - 1))
        ymax = max(0, min(ymax, h_img))

        try:
            dose = float(self.dose_var.get())
        except ValueError:
            messagebox.showwarning("Invalid Dose", "Enter a valid dose value in Gy.")
            return

        if dose < 0:
            messagebox.showwarning("Negative Dose", "Dose should not be negative.")
            return

        roi = self.current_image_array[ymin:ymax, xmin:xmax]

        if self.current_image_array.ndim == 2:
            # Grayscale — use same value for all channels
            val = np.mean(roi) / 255.0
            red_pct, green_pct, blue_pct = val, val, val
        else:
            red_pct = np.mean(roi[:, :, 0]) / 255.0
            green_pct = np.mean(roi[:, :, 1]) / 255.0
            blue_pct = np.mean(roi[:, :, 2]) / 255.0

        point = {
            'dose': dose,
            'red_pct': red_pct,
            'green_pct': green_pct,
            'blue_pct': blue_pct,
            'filename': os.path.basename(self.current_filepath) if self.current_filepath else ""
        }
        self.calibration_points.append(point)
        self._update_table()
        self._update_data_plot()

    def _remove_point(self):
        selected = self.tree.selection()
        if not selected:
            return
        # Get index from the item values
        for item in selected:
            idx = int(self.tree.item(item)['values'][0]) - 1
            if 0 <= idx < len(self.calibration_points):
                self.calibration_points.pop(idx)
        self._update_table()
        self._update_data_plot()

    def _update_table(self):
        self.tree.delete(*self.tree.get_children())
        for i, p in enumerate(self.calibration_points):
            self.tree.insert('', 'end', values=(
                i + 1,
                f"{p['dose']:.3f}",
                f"{p['red_pct']*100:.1f}",
                f"{p['green_pct']*100:.1f}",
                f"{p['blue_pct']*100:.1f}",
                p['filename']
            ))

    def _update_data_plot(self):
        self.ax_curve.clear()
        self.ax_curve.set_title("Calibration Curve")
        self.ax_curve.set_xlabel("Dose (Gy)")
        self.ax_curve.set_ylabel("Color %")
        self.ax_curve.grid(True, alpha=0.3)

        if not self.calibration_points:
            self.canvas.draw()
            return

        doses = [p['dose'] for p in self.calibration_points]
        reds = [p['red_pct'] * 100 for p in self.calibration_points]
        greens = [p['green_pct'] * 100 for p in self.calibration_points]
        blues = [p['blue_pct'] * 100 for p in self.calibration_points]

        self.ax_curve.scatter(doses, reds, c='red', s=40, zorder=5, label='Red')
        self.ax_curve.scatter(doses, greens, c='green', s=40, zorder=5, label='Green')
        self.ax_curve.scatter(doses, blues, c='blue', s=40, zorder=5, label='Blue')

        # If we have fitted curves, draw them
        if self.fitted_params:
            dose_range = np.linspace(0, max(doses) * 1.1, 200)
            colors_map = {'Red': 'red', 'Green': 'green', 'Blue': 'blue'}
            for ch, color in colors_map.items():
                if ch in self.fitted_params:
                    p = self.fitted_params[ch]
                    fit_vals = rational_color_model(dose_range, p['a'], p['b'], p['c']) * 100
                    self.ax_curve.plot(dose_range, fit_vals, color=color, linewidth=2)

        self.ax_curve.legend()
        self.canvas.draw()

    def _fit_curves(self):
        n = len(self.calibration_points)
        if n < 4:
            messagebox.showwarning("Not Enough Points",
                                   f"Need at least 4 data points (have {n}).")
            return

        doses = np.array([p['dose'] for p in self.calibration_points])
        channel_data = {
            'Red': np.array([p['red_pct'] for p in self.calibration_points]),
            'Green': np.array([p['green_pct'] for p in self.calibration_points]),
            'Blue': np.array([p['blue_pct'] for p in self.calibration_points]),
        }

        self.fitted_params = {}
        self.results_text.delete(1.0, tk.END)

        for ch_name, colors in channel_data.items():
            # Initial guesses
            a0 = float(np.min(colors))
            c0 = -1.0
            b0 = (float(np.max(colors)) - a0) * (-c0)

            # Upper bound for c: must be below min dose
            c_upper = float(np.min(doses)) - 0.001

            try:
                popt, _ = curve_fit(
                    rational_color_model, doses, colors,
                    p0=[a0, b0, c0],
                    bounds=([-np.inf, -np.inf, -np.inf],
                            [np.inf, np.inf, c_upper]),
                    maxfev=10000
                )
                a_fit, b_fit, c_fit = popt

                # R-squared
                predicted = rational_color_model(doses, *popt)
                ss_res = np.sum((colors - predicted) ** 2)
                ss_tot = np.sum((colors - np.mean(colors)) ** 2)
                r_sq = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

                self.fitted_params[ch_name] = {
                    'a': float(a_fit), 'b': float(b_fit), 'c': float(c_fit)
                }
                self.results_text.insert(tk.END,
                    f"{ch_name}:\n"
                    f"  a={a_fit:.6f}  b={b_fit:.6f}  c={c_fit:.6f}\n"
                    f"  R²={r_sq:.6f}\n\n")

            except Exception as e:
                self.results_text.insert(tk.END,
                    f"{ch_name}: FIT FAILED - {e}\n\n")

        self._update_data_plot()

    def _save_profile(self):
        if not self.fitted_params:
            messagebox.showwarning("No Fit", "Fit the curves first.")
            return

        profile_name = self.profile_name_var.get().strip()
        if not profile_name:
            messagebox.showwarning("No Name", "Enter a profile name.")
            return

        note = self.note_text.get(1.0, tk.END).strip()
        primary_ch = self.primary_channel_var.get()

        # Build channel params
        channels = {}
        for ch_name, params in self.fitted_params.items():
            channels[ch_name] = {
                'a': params['a'], 'b': params['b'], 'c': params['c']
            }

        # Get a/b/c for the primary channel (for top-level use)
        primary = channels.get(primary_ch, next(iter(channels.values())))

        profile = {
            'name': profile_name,
            'note': note,
            'color_channel': primary_ch,
            'channels': channels,
        }

        self.parent_app.profiles[profile_name] = profile
        self.parent_app._save_config()
        self.parent_app.update_profile_list(profile_name)
        self.parent_app.on_profile_change()

        messagebox.showinfo("Saved", f"Profile '{profile_name}' saved.")


# --- GUI ---

class FilmApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Radiation Film Analysis v{VERSION}")
        self.geometry("1400x900")

        self.analyzer = FilmAnalyzer()
        self.figure = None
        self.ax = None
        self.canvas = None
        self.colorbar = None
        self.roi_start = None
        self.current_roi_rect = None
        self.current_roi_patch = None
        
        self.roi_mode = tk.StringVar(value="Rectangle") # Rectangle or Circle
        
        # When running as a PyInstaller exe, resolve config relative to the exe location
        if getattr(sys, 'frozen', False):
            base_dir = os.path.dirname(sys.executable)
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
        self.config_file = os.path.join(base_dir, "calibration_config.json")
        
        self._setup_ui()
        self._load_config()
        self.update_profile_list()
        self.on_profile_change() # Load initial values

    def _setup_ui(self):
        # Layout: Left Control Panel, Right Image Panel
        control_frame = ttk.Frame(self, padding="10")
        control_frame.pack(side=tk.LEFT, fill=tk.Y)
        
        display_frame = ttk.Frame(self, padding="10")
        display_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # --- Controls ---
        
        # Load File
        ttk.Button(control_frame, text="Load Film Scan", command=self.load_file).pack(pady=5, fill=tk.X)
        self.file_label = ttk.Label(control_frame, text="No file loaded", wraplength=200)
        self.file_label.pack(pady=5)
        
        # DPI Input
        dpi_frame = ttk.Frame(control_frame)
        dpi_frame.pack(fill=tk.X, pady=2)
        ttk.Label(dpi_frame, text="DPI:").pack(side=tk.LEFT)
        self.dpi_var = tk.DoubleVar(value=72.0)
        ttk.Entry(dpi_frame, textvariable=self.dpi_var, width=10).pack(side=tk.RIGHT)

        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=10)

        # Calibration Params
        ttk.Button(control_frame, text="Calibration Wizard...", command=self.open_calibration_wizard).pack(pady=5, fill=tk.X)
        
        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=10)

        ttk.Label(control_frame, text="Calibration Profile:").pack(anchor='w')
        
        prof_frame = ttk.Frame(control_frame)
        prof_frame.pack(fill=tk.X, pady=2)
        
        self.profile_var = tk.StringVar()
        self.profile_combo = ttk.Combobox(prof_frame, textvariable=self.profile_var)
        self.profile_combo.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.profile_combo.bind("<<ComboboxSelected>>", self.on_profile_change)

        self.profile_note_label = ttk.Label(control_frame, text="", wraplength=250, font=("Arial", 7, "italic"))
        self.profile_note_label.pack(anchor='w')

        ttk.Label(control_frame, text="Dose = b / (Color% - a) + c", font=("Arial", 8, "italic")).pack(anchor='w')
        
        params_frame = ttk.Frame(control_frame)
        params_frame.pack(pady=5, fill=tk.X)
        
        # Initial values will be set by load_config -> on_profile_change
        self.a_var = tk.DoubleVar(value=0.0)
        self.b_var = tk.DoubleVar(value=1000.0)
        self.c_var = tk.DoubleVar(value=0.0)
        
        self._add_param_entry(params_frame, "a:", self.a_var)
        self._add_param_entry(params_frame, "b:", self.b_var)
        self._add_param_entry(params_frame, "c:", self.c_var)

        # Channel Selection
        ttk.Label(control_frame, text="Channel:").pack()
        self.channel_var = tk.StringVar(value="Green")
        channel_cb = ttk.Combobox(control_frame, textvariable=self.channel_var, values=["Red", "Green", "Blue", "Gray"])
        channel_cb.pack(fill=tk.X)
        channel_cb.bind("<<ComboboxSelected>>", self.on_channel_change)

        # Colormap Range
        ttk.Label(control_frame, text="Colormap Range:").pack(anchor='w')
        cmap_frame = ttk.Frame(control_frame)
        cmap_frame.pack(fill=tk.X, pady=2)
        ttk.Label(cmap_frame, text="Min:").pack(side=tk.LEFT)
        self.cmap_min_var = tk.DoubleVar(value=0.0)
        ttk.Entry(cmap_frame, textvariable=self.cmap_min_var, width=6).pack(side=tk.LEFT, padx=2)
        ttk.Label(cmap_frame, text="Max:").pack(side=tk.LEFT)
        self.cmap_max_var = tk.DoubleVar(value=40.0)
        ttk.Entry(cmap_frame, textvariable=self.cmap_max_var, width=6).pack(side=tk.LEFT, padx=2)

        ttk.Button(control_frame, text="Apply Calibration / Show Dose", command=self.apply_calibration).pack(pady=10, fill=tk.X)


        ttk.Separator(control_frame, orient='horizontal').pack(fill='x', pady=10)

        # ROI Controls
        ttk.Label(control_frame, text="ROI Analysis").pack(anchor='w')
        ttk.Radiobutton(control_frame, text="Rectangle", variable=self.roi_mode, value="Rectangle", command=self.update_selectors).pack(anchor='w')
        ttk.Radiobutton(control_frame, text="Circle", variable=self.roi_mode, value="Circle", command=self.update_selectors).pack(anchor='w')
        ttk.Radiobutton(control_frame, text="Ring", variable=self.roi_mode, value="Ring", command=self.update_selectors).pack(anchor='w')
        
        # Rotation (Rectangle Only)
        rot_frame = ttk.Frame(control_frame)
        rot_frame.pack(fill=tk.X, pady=2)
        ttk.Label(rot_frame, text="Rotation (deg):").pack(side=tk.LEFT)
        self.rotation_var = tk.DoubleVar(value=0.0)
        self.rotation_entry_var = tk.StringVar(value="0.0")
        rot_entry = ttk.Entry(rot_frame, textvariable=self.rotation_entry_var, width=5)
        rot_entry.pack(side=tk.RIGHT, padx=(2, 0))
        rot_entry.bind("<Return>", self._on_rotation_entry_commit)
        rot_entry.bind("<FocusOut>", self._on_rotation_entry_commit)
        ttk.Scale(rot_frame, variable=self.rotation_var, from_=0, to=360,
                  orient=tk.HORIZONTAL, command=self._on_rotation_scale_change).pack(side=tk.RIGHT, expand=True, fill=tk.X)
        
        # Hole Ratio (Ring Only)
        hole_frame = ttk.Frame(control_frame)
        hole_frame.pack(fill=tk.X, pady=2)
        ttk.Label(hole_frame, text="Hole Ratio (%):").pack(side=tk.LEFT)
        self.hole_ratio_var = tk.DoubleVar(value=50.0)
        self.hole_ratio_var.trace_add("write", lambda *args: self.calculate_current_roi_stats())
        ttk.Scale(hole_frame, variable=self.hole_ratio_var, from_=10, to=90, orient=tk.HORIZONTAL).pack(side=tk.RIGHT, expand=True, fill=tk.X)
        
        # Threshold
        thresh_frame = ttk.Frame(control_frame)
        thresh_frame.pack(fill=tk.X, pady=5)
        ttk.Label(thresh_frame, text="Threshold (>):").pack(side=tk.LEFT)
        self.threshold_var = tk.DoubleVar(value=0.0)
        ttk.Entry(thresh_frame, textvariable=self.threshold_var, width=10).pack(side=tk.RIGHT)

        ttk.Button(control_frame, text="Calculate ROI Stats", command=self.calculate_current_roi_stats).pack(pady=5, fill=tk.X)
        
        # Statistics Output
        self.stats_text = tk.Text(control_frame, height=20, width=30)
        self.stats_text.pack(pady=10)

        # Matplotlib Area
        self.figure = Figure(figsize=(5, 5), dpi=100)
        self.ax = self.figure.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.figure, master=display_frame)
        self.canvas.draw()
        self.canvas.get_tk_widget().pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Toolbar
        toolbar = NavigationToolbar2Tk(self.canvas, display_frame)
        toolbar.update()

        self._setup_selectors()

    def _refresh_figure(self):
        """Clear the entire figure and recreate axes + selectors to prevent layout drift."""
        self.figure.clf()
        self.ax = self.figure.add_subplot(111)
        self.colorbar = None
        self.current_roi_patch = None
        self._setup_selectors()

    def _setup_selectors(self):
        # Clear old selectors to avoid interference
        if hasattr(self, 'rect_selector') and self.rect_selector:
            try: self.rect_selector.set_active(False)
            except: pass
        if hasattr(self, 'ellipse_selector') and self.ellipse_selector:
            try: self.ellipse_selector.set_active(False)
            except: pass

        self.rect_selector = RectangleSelector(
            self.ax, self.on_select,
            interactive=True,
            useblit=True,
            button=[1], 
            props=dict(facecolor='r', edgecolor='r', alpha=0.2, fill=True) 
        )
        self.ellipse_selector = EllipseSelector(
            self.ax, self.on_select,
            interactive=True,
            useblit=True,
            button=[1], 
            props=dict(facecolor='r', edgecolor='r', alpha=0.2, fill=True)
        )
        self.update_selectors()

    def update_selectors(self):
        mode = self.roi_mode.get()
        if mode == "Rectangle":
            self.rect_selector.set_active(True)
            self.ellipse_selector.set_active(False)
        elif mode in ["Circle", "Ring"]:
            self.rect_selector.set_active(False)
            self.ellipse_selector.set_active(True)
        self.canvas.draw()

    def _on_rotation_scale_change(self, value):
        self.rotation_entry_var.set(f"{float(value):.1f}")
        self.calculate_current_roi_stats()

    def _on_rotation_entry_commit(self, event=None):
        try:
            val = float(self.rotation_entry_var.get())
            self.rotation_var.set(val)
            self.calculate_current_roi_stats()
        except ValueError:
            self.rotation_entry_var.set(f"{self.rotation_var.get():.1f}")

    def _add_param_entry(self, parent, label, var):
        f = ttk.Frame(parent)
        f.pack(fill=tk.X, pady=2)
        ttk.Label(f, text=label, width=5).pack(side=tk.LEFT)
        ttk.Entry(f, textvariable=var).pack(side=tk.RIGHT, expand=True, fill=tk.X)

    def load_file(self):
        path = filedialog.askopenfilename(filetypes=[("Images", "*.tif;*.png;*.jpg;*.jpeg")])
        if path:
            try:
                self.analyzer.load_image(path)
                self.dpi_var.set(self.analyzer.dpi) # Update DPI input
                self.file_label.config(text=f"Loaded: {path.split('/')[-1]}")
                self.show_image(self.analyzer.image_array)
            except Exception as e:
                messagebox.showerror("Error", f"Failed to load image: {e}")

    def show_image(self, img_data):
        self._refresh_figure()
        if img_data.ndim == 2:
            self.ax.imshow(img_data, cmap='gray')
        else:
            self.ax.imshow(img_data)
        self.canvas.draw()

    def apply_calibration(self):
        try:
            dose_map = self.analyzer.calculate_dose_map(
                self.channel_var.get(),
                self.a_var.get(),
                self.b_var.get(),
                self.c_var.get()
            )
            self._refresh_figure()
            im = self.ax.imshow(dose_map, cmap='jet', vmin=self.cmap_min_var.get(), vmax=self.cmap_max_var.get())
            self.colorbar = self.figure.colorbar(im, ax=self.ax, label="Dose (Gy or unit)")
            self.canvas.draw()
            self._save_config()
        except Exception as e:
            messagebox.showerror("Error", f"Calibration failed: {e}")

    def _load_config(self):
        self.profiles = {}
        self.current_profile = "Default"

        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    data = json.load(f)

                if 'profiles' in data:
                    self.profiles = data['profiles']
                    self.current_profile = data.get('current', "Default")
                else:
                    # Migrate old flat config
                    ch = data.get('color_channel', 'Green')
                    old_profile = {
                        'name': 'Default',
                        'note': '',
                        'color_channel': ch,
                        'channels': {
                            ch: {'a': data.get('a', 0.0), 'b': data.get('b', 1000.0), 'c': data.get('c', 0.0)}
                        }
                    }
                    self.profiles = {"Default": old_profile}
                    self.current_profile = "Default"

                # Migrate any old-format profiles (have top-level a/b/c but no channels dict)
                for name, p in self.profiles.items():
                    if 'channels' not in p:
                        ch = p.get('color_channel', 'Green')
                        p['channels'] = {
                            ch: {'a': p.get('a', 0.0), 'b': p.get('b', 1000.0), 'c': p.get('c', 0.0)}
                        }
                        p.setdefault('name', name)
                        p.setdefault('note', '')
                        # Remove old top-level keys
                        for key in ('a', 'b', 'c'):
                            p.pop(key, None)
            except:
                pass

        # Ensure at least one profile
        if not self.profiles:
            self.profiles = {"Default": {
                'name': 'Default', 'note': '', 'color_channel': 'Green',
                'channels': {'Green': {'a': 0.0, 'b': 1000.0, 'c': 0.0}}
            }}

    def _save_config(self):
        # Update current profile data from UI
        name = self.profile_var.get()
        if not name:
            name = "Default"

        ch = self.channel_var.get()

        # Get or create profile
        if name not in self.profiles:
            self.profiles[name] = {
                'name': name, 'note': '', 'color_channel': ch, 'channels': {}
            }

        p = self.profiles[name]
        p['color_channel'] = ch

        # Update the current channel's params
        if 'channels' not in p:
            p['channels'] = {}
        p['channels'][ch] = {
            'a': self.a_var.get(),
            'b': self.b_var.get(),
            'c': self.c_var.get()
        }

        data = {
            'profiles': self.profiles,
            'current': name
        }

        try:
            with open(self.config_file, 'w') as f:
                json.dump(data, f, indent=4)
            self.update_profile_list(name)
        except Exception as e:
            print(f"Failed to save config: {e}")

    def update_profile_list(self, current_selection=None):
        names = list(self.profiles.keys())
        self.profile_combo['values'] = names
        if current_selection and current_selection in names:
            self.profile_combo.set(current_selection)
        elif self.current_profile in names:
            self.profile_combo.set(self.current_profile)
            
    def on_profile_change(self, event=None):
        name = self.profile_var.get()
        if name in self.profiles:
            p = self.profiles[name]
            ch = p.get('color_channel', 'Green')
            self.channel_var.set(ch)
            self._load_channel_params(p, ch)

            # Update name/note display
            display_name = p.get('name', name)
            note = p.get('note', '')
            tip = display_name
            if note:
                tip += f" — {note}"
            self.profile_note_label.config(text=tip)

    def on_channel_change(self, event=None):
        name = self.profile_var.get()
        if name in self.profiles:
            p = self.profiles[name]
            ch = self.channel_var.get()
            self._load_channel_params(p, ch)

    def _load_channel_params(self, profile, channel):
        channels = profile.get('channels', {})
        if channel in channels:
            ch_data = channels[channel]
            self.a_var.set(ch_data.get('a', 0.0))
            self.b_var.set(ch_data.get('b', 1000.0))
            self.c_var.set(ch_data.get('c', 0.0))
        else:
            # Channel not calibrated — use first available or defaults
            if channels:
                first = next(iter(channels.values()))
                self.a_var.set(first.get('a', 0.0))
                self.b_var.set(first.get('b', 1000.0))
                self.c_var.set(first.get('c', 0.0))
            else:
                self.a_var.set(0.0)
                self.b_var.set(1000.0)
                self.c_var.set(0.0)

    def open_calibration_wizard(self):
        CalibrationWizard(self)

    # --- Interaction ---
    def on_select(self, eclick, erelease):
        # Triggered by selectors
        if self.roi_mode.get() == "Rectangle":
            extents = self.rect_selector.extents # xmin, xmax, ymin, ymax
            bbox = (extents[0], extents[2], extents[1]-extents[0], extents[3]-extents[2])
            self.calculate_roi_stats(bbox)
        else:
            extents = self.ellipse_selector.extents
            bbox = (extents[0], extents[2], extents[1]-extents[0], extents[3]-extents[2])
            self.calculate_roi_stats(bbox)

    def calculate_current_roi_stats(self):
        # Force re-calc if needed (e.g. threshold changed)
        # We need the current bbox from the active selector
        if self.roi_mode.get() == "Rectangle":
            # Selectors persist, trust mode
            extents = self.rect_selector.extents
        else:
            extents = self.ellipse_selector.extents
            
        bbox = (extents[0], extents[2], extents[1]-extents[0], extents[3]-extents[2])
        self.calculate_roi_stats(bbox)

    def calculate_roi_stats(self, bbox):
        # bbox = (x, y, w, h)
        if self.analyzer.dose_map is None:
            return

        x, y, w, h = bbox
        # Create mask
        rows, cols = self.analyzer.dose_map.shape
        Y, X = np.ogrid[:rows, :cols]
        
        if self.roi_mode.get() == "Rectangle":
            angle = self.rotation_var.get()
            if angle == 0:
                mask = (X >= x) & (X <= x+w) & (Y >= y) & (Y <= y+h)
            else:
                # Rotated Rectangle Logic
                # 1. Calculate center
                cx, cy = x + w/2, y + h/2
                # 2. visual patch rotation (optional, might conflict with selector but good to try)
                # self.rect_selector.to_draw.set_transform(...) - hard to do with selector active.
                # Instead, we just calculate the mask based on the rotation.

                # 3. Create path from corners
                # Corners relative to center (before rotation)
                hw, hh = w/2, h/2
                corners = np.array([
                    [-hw, -hh],
                    [hw, -hh],
                    [hw, hh],
                    [-hw, hh]
                ]) # (4, 2)
                
                # Rotate
                trans = Affine2D().rotate_deg(angle) # Rotate around (0,0)
                rot_corners = trans.transform(corners)
                
                # Add center back
                final_corners = rot_corners + [cx, cy]
                
                # Create Path and mask
                # Optimization: checks only bounding box of rotated rect?
                # For simplicity, check all points or use efficient poly fill?
                # matplotlib Path.contains_points is slow for full image.
                # Efficient approach: skimage.draw.polygon or similar.
                # We don't have skimage.
                # Let's use meshgrid and transform points to Rect local coords?
                
                # Transform (X,Y) -> Rotate -angle around (cx,cy) -> check if inside unrotated box
                # P' = R(-angle) * (P - C) + C
                
                # Radians
                rad = -np.radians(angle)
                cos_a, sin_a = np.cos(rad), np.sin(rad)
                
                dX = X - cx
                dY = Y - cy
                
                # Rotate
                rotX = dX * cos_a - dY * sin_a
                rotY = dX * sin_a + dY * cos_a
                
                # Check bounds (relative to center, unrotated box extends from -hw to hw, -hh to hh)
                mask = (rotX >= -hw) & (rotX <= hw) & (rotY >= -hh) & (rotY <= hh)
                
                # Update Visual Rotation Patch
                if self.current_roi_patch:
                    self.current_roi_patch.remove()
                
                # Create a rectangle patch for visualization
                # xy is bottom-left corner relative to rotation anchor?
                # Rectangle((x,y), w, h, angle=...) rotates around (x,y) by default.
                # We want to rotate around center (cx, cy).
                # Matplotlib Rectangle rotation point is xy. 
                # So we need to calculate where the bottom-left corner ends up? 
                # Actually, easier to use an Affine2D transform on the patch.
                
                # Unrotated bottom-left
                bl_x = cx - hw
                bl_y = cy - hh
                
                rect = patches.Rectangle((bl_x, bl_y), w, h, angle=0.0, linewidth=2, edgecolor='yellow', facecolor='none')
                
                # Rotate around center
                t = Affine2D().rotate_deg_around(cx, cy, angle) + self.ax.transData
                rect.set_transform(t)
                
                self.current_roi_patch = rect
                self.ax.add_patch(self.current_roi_patch)
                self.canvas.draw()
                
        else:
            # Ellipse / Ring mask
            # Matplotlib EllipseSelector: extents are xmin, xmax, ymin, ymax
            # Center and radii
            cx, cy = x + w/2, y + h/2
            rx, ry = w/2, h/2
            
            # Helper to clear patches
            if self.current_roi_patch: 
                 if isinstance(self.current_roi_patch, list):
                     for p in self.current_roi_patch: p.remove()
                 else:
                     self.current_roi_patch.remove()
                 self.current_roi_patch = None
                 self.canvas.draw()

            if rx == 0 or ry == 0: return
            
            # Normalized distance squared
            dist_sq = ((X - cx)**2 / rx**2 + (Y - cy)**2 / ry**2)
            
            if self.roi_mode.get() == "Circle":
                mask = dist_sq <= 1
            else: # Ring
                try:
                    ratio = self.hole_ratio_var.get() / 100.0
                except: ratio = 0.5
                mask = (dist_sq <= 1) & (dist_sq >= ratio**2)
                
                # Visual patch for inner hole
                inner_rx = rx * ratio
                inner_ry = ry * ratio
                
                # Draw Inner Ellipse
                inner_patch = patches.Ellipse((cx, cy), inner_rx*2, inner_ry*2, linewidth=1, edgecolor='yellow', facecolor='none', linestyle='--')
                self.ax.add_patch(inner_patch)
                self.current_roi_patch = inner_patch # Track to delete later (if using list, can handle multiples)
                self.canvas.draw()

        # Apply threshold if set
        try:
            threshold = self.threshold_var.get()
            if threshold > 0:
                mask = mask & (self.analyzer.dose_map > threshold)
        except:
            pass

        stats = self.analyzer.get_roi_stats(mask)
        
        self.stats_text.delete(1.0, tk.END)
        if stats:
            # Physical Stats
            try:
                 dpi = self.dpi_var.get()
                 if dpi <= 0: dpi = 72.0
            except: dpi = 72.0
            
            mm_per_px = 25.4 / dpi
            
            # Centroid (X, Y) relative to image center or top-left? 
            # Usually users care about pos relative to image origin (Top-Left is standard for image coords).
            # We have bbox = x, y, w, h in pixels.
            # Center of ROI:
            center_x_px = x + w/2
            center_y_px = y + h/2
            
            center_x_mm = center_x_px * mm_per_px
            center_y_mm = center_y_px * mm_per_px
            
            # Area
            # Effective area (number of pixels in mask)
            pixel_count = np.count_nonzero(mask)
            area_mm2 = pixel_count * (mm_per_px ** 2)

            # Dimensions
            width_mm = w * mm_per_px
            height_mm = h * mm_per_px

            # internal diameter
            if self.roi_mode.get() == "Ring":
                inner_rx_mm = inner_rx * 2 * mm_per_px
                inner_ry_mm = inner_ry * 2 * mm_per_px
            else:
                inner_rx_mm = 0
                inner_ry_mm = 0
            
            if self.roi_mode.get() == "Rectangle":
                res = (
                f"Max: {stats['max']:.3f}\n"
                f"Min: {stats['min']:.3f}\n"
                f"Mean: {stats['mean']:.3f}\n"
                f"Std: {stats['std']:.3f}\n"
                f"CV(%): {stats['cv']:.3f}\n"
                f"DUR (Max/Min): {stats['dur']:.3f}\n"
                f"Flatness(%): {stats['flatness']:.1f}\n"
                f"----------------\n"
                f"Center X: {center_x_mm:.2f} mm\n"
                f"Center Y: {center_y_mm:.2f} mm\n"
                f"Width: {width_mm:.2f} mm\n"
                f"Height: {height_mm:.2f} mm\n"
                f"Area: {area_mm2:.2f} mm²\n"
            )
            else:
                res = (
                f"Max: {stats['max']:.3f}\n"
                f"Min: {stats['min']:.3f}\n"
                f"Mean: {stats['mean']:.3f}\n"
                f"Std: {stats['std']:.3f}\n"
                f"CV(%): {stats['cv']:.3f}\n"
                f"DUR (Max/Min): {stats['dur']:.3f}\n"
                f"Flatness(%): {stats['flatness']:.1f}\n"
                f"----------------\n"
                f"Center X: {center_x_mm:.2f} mm\n"
                f"Center Y: {center_y_mm:.2f} mm\n"
                f"Width: {width_mm:.2f} mm\n"
                f"Height: {height_mm:.2f} mm\n"
                f"Inner Width: {inner_rx_mm:.2f} mm\n"
                f"Inner Height: {inner_ry_mm:.2f} mm\n"
                f"Area: {area_mm2:.2f} mm²\n"
            )

            self.stats_text.insert(tk.END, res)
        else:
            self.stats_text.insert(tk.END, "No valid data in ROI")

if __name__ == "__main__":
    app = FilmApp()
    app.mainloop()
