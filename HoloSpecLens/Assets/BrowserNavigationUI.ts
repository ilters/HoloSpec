import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";

/**
 * Handles all browser navigation UI components (buttons, URL bar)
 * This is separate from RemoteBrowserClient so the core can work without UI
 */
@component
export class BrowserNavigationUI extends BaseScriptComponent {
  @input
  @allowUndefined
  @label("Remote Browser Client")
  @hint("The RemoteBrowserClient component to control")
  browserClient: any; // RemoteBrowserClient
  
  @input
  @allowUndefined
  @label("Back Button")
  @hint("Optional: Assign the RectangleButton component (UIKit) for browser back navigation")
  backButton: RectangleButton;
  
  @input
  @allowUndefined
  @label("Forward Button")
  @hint("Optional: Assign the RectangleButton component (UIKit) for browser forward navigation")
  forwardButton: RectangleButton;
  
  @input
  @allowUndefined
  @label("URL Text Field")
  @hint("Optional: TextInputField component for URL input and display")
  urlTextField: any; // TextInputField from SpectaclesUIKit
  
  @input
  @allowUndefined
  @label("Go Button")
  @hint("Optional: Assign the RectangleButton component (UIKit) to navigate to URL")
  goButton: RectangleButton;
  
  @input
  @allowUndefined
  @label("Keyboard Toggle Button")
  @hint("Optional: Assign the RectangleButton component (UIKit) that toggles the keyboard on/off")
  keyboardToggleButton: RectangleButton;
  
  onAwake() {
    if (!this.browserClient) {
      print("BrowserNavigationUI: No browser client assigned!");
      return;
    }
    
    this.initializeNavigationButtons();
    this.initializeUrlBar();
    this.initializeKeyboardButton();
    this.subscribeToUrlChanges();
  }
  
  /**
   * Initialize navigation buttons
   */
  private initializeNavigationButtons() {
    // Set up back button if provided
    if (this.backButton?.onTriggerUp && typeof this.backButton.onTriggerUp.add === "function") {
      this.backButton.onTriggerUp.add(() => {
        this.browserClient.goBack();
      });
    }
    
    // Set up forward button if provided
    if (this.forwardButton?.onTriggerUp && typeof this.forwardButton.onTriggerUp.add === "function") {
      this.forwardButton.onTriggerUp.add(() => {
        this.browserClient.goForward();
      });
    }
  }
  
  /**
   * Initialize URL bar
   */
  private initializeUrlBar() {
    // Set up URL text field if provided
    if (this.urlTextField?.onReturnKeyPressed && typeof this.urlTextField.onReturnKeyPressed.add === "function") {
      // Listen for return key press (user wants to navigate)
      this.urlTextField.onReturnKeyPressed.add((url: string) => {
        this.navigateToUrl(url);
      });
    }
    
    // Set up Go button if provided
    if (this.goButton?.onTriggerUp && typeof this.goButton.onTriggerUp.add === "function") {
      this.goButton.onTriggerUp.add(() => {
        const url = this.urlTextField ? this.urlTextField.text : "";
        this.navigateToUrl(url);
      });
    }
  }
  
  /**
   * Initialize keyboard toggle button
   */
  private initializeKeyboardButton() {
    if (this.keyboardToggleButton?.onTriggerUp && typeof this.keyboardToggleButton.onTriggerUp.add === "function") {
      this.keyboardToggleButton.onTriggerUp.add(() => {
        this.browserClient.toggleKeyboard();
      });
    }
  }
  
  /**
   * Subscribe to URL changes from the browser client
   */
  private subscribeToUrlChanges() {
    if (this.browserClient?.onUrlChanged && typeof this.browserClient.onUrlChanged.add === "function") {
      this.browserClient.onUrlChanged.add((url: string) => {
        this.updateUrlDisplay(url);
      });
    }
  }
  
  /**
   * Update the URL display text field
   */
  private updateUrlDisplay(url: string) {
    if (this.urlTextField && url) {
      this.urlTextField.text = url;
    }
  }
  
  /**
   * Navigate to the specified URL or search query
   */
  private navigateToUrl(url: string) {
    if (!url || url.trim().length === 0) {
      return;
    }
    
    // Pass the URL directly to the browser client without modification
    // The backend will handle URL validation and search query detection
    const finalUrl = url.trim();
    
    this.browserClient.navigate(finalUrl);
  }
}
