import { appConfig } from './app-config.js';

/**
 * ExportManager - Handles data export functionality
 *
 * Provides CSV export capabilities for all data tables including:
 * - Device measurements (raw sensor data)
 * - Processed measurements (analyzed data with rate control)
 * - Control states (current system state)
 * - Weather history (historical weather data)
 *
 * Supports both server-side export (full database) and client-side export (current view)
 */
class ExportManager {
  /**
   * Initializes the export manager and sets up UI event handlers
   */
  constructor() {
    this.modal = null;
    this.dataTypeSelect = null;
    this.startDateInput = null;
    this.endDateInput = null;
    this.exportButton = null;
    this.cancelButton = null;
    this.closeButton = null;
    this.limitInput = null;

    console.log('✅ ExportManager initialized');
  }

  /**
   * Binds export manager to DOM elements and sets up event listeners
   *
   * This method should be called after DOM is fully loaded
   */
  init() {
    // Get modal elements
    this.modal = document.getElementById('export-modal');
    this.dataTypeSelect = document.getElementById('export-data-type');
    this.startDateInput = document.getElementById('export-start-date');
    this.endDateInput = document.getElementById('export-end-date');
    this.limitInput = document.getElementById('export-limit');
    this.exportButton = document.getElementById('export-confirm-btn');
    this.cancelButton = document.getElementById('export-cancel-btn');
    this.closeButton = document.getElementById('export-close-btn');

    // Get trigger button
    const openButton = document.getElementById('export-data-btn');

    if (!this.modal || !openButton) {
      console.warn('⚠️ Export modal elements not found in DOM');
      return;
    }

    // Set up event listeners
    openButton.addEventListener('click', () => this.openModal());
    this.closeButton?.addEventListener('click', () => this.closeModal());
    this.cancelButton?.addEventListener('click', () => this.closeModal());
    this.exportButton?.addEventListener('click', () => this.handleExport());

    // Close modal when clicking outside
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.closeModal();
      }
    });

    // Set default dates (last 7 days)
    this.setDefaultDates();

    console.log('✅ ExportManager UI bindings complete');
  }

  /**
   * Sets default date range (last 7 days)
   */
  setDefaultDates() {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (this.endDateInput) {
      this.endDateInput.value = now.toISOString().split('T')[0];
    }

    if (this.startDateInput) {
      this.startDateInput.value = sevenDaysAgo.toISOString().split('T')[0];
    }
  }

  /**
   * Opens the export modal dialog
   */
  openModal() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      console.log('📂 Export modal opened');
    }
  }

  /**
   * Closes the export modal dialog
   */
  closeModal() {
    if (this.modal) {
      this.modal.classList.add('hidden');
      console.log('📂 Export modal closed');
    }
  }

  /**
   * Handles export button click - validates inputs and triggers download
   */
  async handleExport() {
    const dataType = this.dataTypeSelect?.value;
    const startDate = this.startDateInput?.value;
    const endDate = this.endDateInput?.value;
    const limit = this.limitInput?.value;

    if (!dataType) {
      this.showError('データタイプを選択してください');
      return;
    }

    console.log(`📊 Exporting ${dataType} data...`, { startDate, endDate, limit });

    try {
      // Show loading state
      this.setLoadingState(true);

      // Build API endpoint URL
      const endpoint = this.buildExportEndpoint(dataType, {
        startDate,
        endDate,
        limit
      });

      // Trigger download
      await this.downloadCSV(endpoint);

      // Close modal on success
      this.closeModal();
      this.showSuccess(`${dataType}のエクスポートが完了しました`);
    } catch (error) {
      console.error('❌ Export failed:', error);
      this.showError(`エクスポートに失敗しました: ${error.message}`);
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Builds the API endpoint URL with query parameters
   *
   * @param {string} dataType - Type of data to export
   * @param {Object} options - Export options (startDate, endDate, limit)
   * @returns {string} Complete API endpoint URL
   */
  buildExportEndpoint(dataType, options = {}) {
    const { startDate, endDate, limit } = options;
    const params = new URLSearchParams();

    if (startDate) {
      params.append('startDate', startDate);
    }

    if (endDate) {
      // Add one day to endDate to make it inclusive
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      params.append('endDate', endDateObj.toISOString().split('T')[0]);
    }

    if (limit && Number(limit) > 0) {
      params.append('limit', limit);
    }

    const endpoint = `${appConfig.api.baseUrl}/api/export/${dataType}`;
    const queryString = params.toString();

    return queryString ? `${endpoint}?${queryString}` : endpoint;
  }

  /**
   * Downloads CSV file from API endpoint
   *
   * Creates a temporary anchor element to trigger browser download
   *
   * @param {string} url - API endpoint URL
   */
  async downloadCSV(url) {
    console.log(`⬇️ Downloading CSV from: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    // Get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'export.csv';

    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }

    // Get CSV content as blob
    const blob = await response.blob();

    // Create download link
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = 'none';

    // Trigger download
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    console.log(`✅ CSV download complete: ${filename}`);
  }

  /**
   * Sets loading state for export button
   *
   * @param {boolean} isLoading - Whether export is in progress
   */
  setLoadingState(isLoading) {
    if (!this.exportButton) return;

    if (isLoading) {
      this.exportButton.disabled = true;
      this.exportButton.innerHTML = `
        <svg class="animate-spin h-5 w-5 mr-2 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        エクスポート中...
      `;
      this.exportButton.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      this.exportButton.disabled = false;
      this.exportButton.innerHTML = `
        <svg class="w-5 h-5 mr-2 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
        </svg>
        ダウンロード
      `;
      this.exportButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  /**
   * Shows success notification
   *
   * @param {string} message - Success message to display
   */
  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  /**
   * Shows error notification
   *
   * @param {string} message - Error message to display
   */
  showError(message) {
    this.showNotification(message, 'error');
  }

  /**
   * Shows notification toast
   *
   * @param {string} message - Notification message
   * @param {string} type - Notification type ('success' or 'error')
   */
  showNotification(message, type = 'info') {
    const container = document.getElementById('alert-container');
    if (!container) return;

    const bgColor = type === 'success' ? 'bg-green-100' : 'bg-red-100';
    const textColor = type === 'success' ? 'text-green-800' : 'text-red-800';
    const borderColor = type === 'success' ? 'border-green-400' : 'border-red-400';
    const icon = type === 'success' ? '✓' : '✕';

    const alert = document.createElement('div');
    alert.className = `${bgColor} ${textColor} ${borderColor} border px-4 py-3 rounded-lg mb-4 flex items-center justify-between animate-fade-in`;
    alert.innerHTML = `
      <div class="flex items-center">
        <span class="font-bold mr-2">${icon}</span>
        <span>${message}</span>
      </div>
      <button class="ml-4 font-bold hover:opacity-70" onclick="this.parentElement.remove()">×</button>
    `;

    container.appendChild(alert);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      alert.remove();
    }, 5000);
  }

  /**
   * Exports current dashboard data to CSV (client-side)
   *
   * This method generates CSV from data currently displayed in charts/tables
   * without making API calls to the backend.
   *
   * @param {Array<Object>} data - Array of data objects to export
   * @param {string} filename - Name for downloaded file
   */
  exportClientSideCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
      this.showError('エクスポートするデータがありません');
      return;
    }

    console.log(`📊 Client-side export: ${data.length} records`);

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Build CSV string
    let csv = '\uFEFF'; // UTF-8 BOM
    csv += headers.join(',') + '\n';

    for (const row of data) {
      const values = headers.map((header) => {
        const value = row[header];
        if (value === null || value === undefined) return '';

        // Escape CSV special characters
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });

      csv += values.join(',') + '\n';
    }

    // Trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    console.log(`✅ Client-side export complete: ${filename}`);
    this.showSuccess(`${filename}をダウンロードしました`);
  }
}

// Create and export singleton instance
const exportManager = new ExportManager();

export { exportManager };
