import { RemoteBrowserClient } from "RemoteBrowserManager";

@component
export class GenUIWebSample extends BaseScriptComponent {
  @input
  internetModule: InternetModule;
  
  @input
  @allowUndefined
  @label("Remote Browser Client")
  @hint("The RemoteBrowserClient component to control navigation and get server URL")
  browserClient: RemoteBrowserClient; // Reference to RemoteBrowserClient
  
  @input
  @label("Update Interval (seconds)")
  @hint("How often to cycle through HTML pages")
  updateInterval: number = 5.0;
  
  @input
  @label("Enable Auto Cycle")
  @hint("Automatically cycle through pages")
  enableAutoCycle: boolean = true;
  
  // Preset HTML pages
  private htmlPages: string[] = [
    `<!DOCTYPE html>
<html>
<head>
  <title>Snap Intelligence - Page 1</title>
  <style>
    body { 
      margin: 0; 
      padding: 40px;
      font-family: Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    h1 { font-size: 3em; margin: 20px 0; }
    p { font-size: 1.5em; max-width: 600px; text-align: center; }
    .timestamp { opacity: 0.8; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>🚀 Snap Intelligence System</h1>
  <p>Welcome to the AI-Powered Browser Experience</p>
  <div class="timestamp">Page 1 of 3 | Generated at: ${new Date().toLocaleTimeString()}</div>
</body>
</html>`,
    
    `<!DOCTYPE html>
<html>
<head>
  <title>Snap Intelligence - Page 2</title>
  <style>
    body { 
      margin: 0; 
      padding: 40px;
      font-family: 'Courier New', monospace;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    h1 { font-size: 3em; margin: 20px 0; }
    .feature-list { 
      font-size: 1.2em; 
      text-align: left;
      margin: 30px 0;
    }
    .feature-list li { margin: 10px 0; }
    .timestamp { opacity: 0.8; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>⚡ Dynamic Content Generation</h1>
  <ul class="feature-list">
    <li>✓ Real-time HTML rendering</li>
    <li>✓ Spectacles integration</li>
    <li>✓ Auto-refresh capabilities</li>
    <li>✓ Interactive web experiences</li>
  </ul>
  <div class="timestamp">Page 2 of 3 | Generated at: ${new Date().toLocaleTimeString()}</div>
</body>
</html>`,
    
    `<!DOCTYPE html>
<html>
<head>
  <title>Snap Intelligence - Page 3</title>
  <style>
    body { 
      margin: 0; 
      padding: 40px;
      font-family: 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      color: #222;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    h1 { 
      font-size: 3em; 
      margin: 20px 0;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    }
    .stats { 
      font-size: 1.3em; 
      background: rgba(255,255,255,0.9);
      padding: 30px;
      border-radius: 15px;
      margin: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .timestamp { opacity: 0.8; margin-top: 30px; color: #222; }
  </style>
</head>
<body>
  <h1>📊 System Status</h1>
  <div class="stats">
    <div><strong>Status:</strong> Active</div>
    <div><strong>Mode:</strong> Auto-Cycle</div>
    <div><strong>Interval:</strong> 5 seconds</div>
    <div><strong>Server:</strong> Connected</div>
  </div>
  <div class="timestamp">Page 3 of 3 | Generated at: ${new Date().toLocaleTimeString()}</div>
</body>
</html>`
  ];
  
  private currentPageIndex: number = 0;
  private updateEvent: DelayedCallbackEvent | null = null;
  
  // Get server URL by converting WebSocket URL from browserClient to HTTP(S)
  private get SERVER_URL(): string {
    if (!this.browserClient) {
      print("GenUIWebSample: No browser client reference, using default URL");
      return 'https://remote-browser-production.up.railway.app';
    }
    
    // Get WebSocket URL from browser client (wss:// or ws://)
    const wsUrl = this.browserClient.getServerUrl();
    
    // Convert WebSocket URL to HTTP URL
    // wss:// -> https://, ws:// -> http://
    const httpUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    
    return httpUrl;
  }
  
  onAwake() {
    print("GenUIWebSample: Starting...");
    
    if (this.enableAutoCycle) {
      this.startCycling();
    }
  }
  
  /**
   * Start the automatic cycling of HTML pages
   */
  startCycling() {
    print("GenUIWebSample: Starting auto-cycle every " + this.updateInterval + " seconds");
    
    // Send first page immediately
    this.sendNextPage();
    
    // Schedule periodic updates
    this.scheduleNextUpdate();
  }
  
  /**
   * Stop the automatic cycling
   */
  stopCycling() {
    if (this.updateEvent) {
      this.updateEvent.enabled = false;
      this.updateEvent = null;
    }
    print("GenUIWebSample: Auto-cycle stopped");
  }
  
  /**
   * Schedule the next update
   */
  private scheduleNextUpdate() {
    if (this.updateEvent) {
      this.updateEvent.enabled = false;
    }
    
    this.updateEvent = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.updateEvent.bind(() => {
      this.sendNextPage();
      this.scheduleNextUpdate();
    });
    this.updateEvent.reset(this.updateInterval);
  }
  
  /**
   * Send the next HTML page in the rotation
   */
  private sendNextPage() {
    const htmlContent = this.htmlPages[this.currentPageIndex];
    
    print("GenUIWebSample: Sending page " + (this.currentPageIndex + 1) + " of " + this.htmlPages.length);
    
    // Send POST request
    this.sendPostRequest(htmlContent);
    
    // Move to next page (round robin)
    this.currentPageIndex = (this.currentPageIndex + 1) % this.htmlPages.length;
  }
  
  /**
   * Send POST request to /gen-ui endpoint
   */
  private async sendPostRequest(htmlContent: string) {
    try {
      const url = this.SERVER_URL + '/gen-ui';

      print("GenUIWebSample: Sending POST request to " + url);

      // Lens Studio's Request constructor is not publicly instantiable in TS,
      // so send the request via fetch(url, options) instead.
      const response = await this.internetModule.fetch(url, {
        method: 'POST',
        body: JSON.stringify({ html: htmlContent }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      print("GenUIWebSample: POST request completed - Status: " + response.status);
      
      // Check if request was successful
      if (response.status >= 200 && response.status < 300) {
        const responseText = await response.text();
        print("GenUIWebSample: Response: " + responseText);
        
        // Navigate to /gen-ui page after successful POST
        this.navigateToGenUI();
      } else {
        print("GenUIWebSample: POST request failed with status: " + response.status);
      }
      
    } catch (error) {
      print("GenUIWebSample: Error sending request - " + error);
    }
  }
  
  /**
   * Navigate the browser to /gen-ui page
   */
  private navigateToGenUI() {
    if (!this.browserClient) {
      print("GenUIWebSample: No browser client reference set");
      return;
    }
    
    try {
      const genUiUrl = this.SERVER_URL + '/gen-ui';
      
      // Check if we're already on the gen-ui page
      const currentUrl = this.browserClient.getCurrentUrl();
      
      if (currentUrl && currentUrl.includes('/gen-ui')) {
        // Already on gen-ui page, just refresh
        print("GenUIWebSample: Refreshing /gen-ui page");
        this.browserClient.refresh();
      } else {
        // Navigate to gen-ui page
        print("GenUIWebSample: Navigating to " + genUiUrl);
        this.browserClient.navigate(genUiUrl);
      }
    } catch (error) {
      print("GenUIWebSample: Error navigating - " + error);
    }
  }
  
  /**
   * Manually trigger sending a specific page (for testing)
   */
  public sendPage(pageIndex: number) {
    if (pageIndex >= 0 && pageIndex < this.htmlPages.length) {
      this.currentPageIndex = pageIndex;
      this.sendNextPage();
    } else {
      print("GenUIWebSample: Invalid page index - " + pageIndex);
    }
  }
  
  onDestroy() {
    this.stopCycling();
  }
}
