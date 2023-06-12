import {
  FormValues,
  GenerateUiConfiguration,
  GenerateUiInputMessage,
  GenerateUiOutputMessage,
  GenerateUiRequestValidationOutputMessage,
  GenerateUiStyles,
  GeneratorSchema,
  ValidationResults,
} from '@nx-console/shared/generate-ui-types';
import { Option, OptionType } from '@nx-console/shared/schema';
import { ReactiveController, ReactiveControllerHost } from 'lit';

import type { WebviewApi } from 'vscode-webview';

export class IdeCommunicationController implements ReactiveController {
  editor: 'vscode' | 'intellij';
  generatorSchema: GeneratorSchema | undefined;
  configuration: GenerateUiConfiguration | undefined;

  banner:
    | {
        message: string;
        type: 'info' | 'warning' | 'error';
      }
    | undefined;

  private postToIde: (message: unknown) => void;

  constructor(private host: ReactiveControllerHost) {
    let vscode: WebviewApi<undefined> | undefined;
    try {
      vscode = acquireVsCodeApi();
    } catch (e) {
      // noop
    }

    this.editor = vscode ? 'vscode' : 'intellij';
    console.log('initializing ide communication for', this.editor);

    if (vscode) {
      this.setupVscodeCommunication(vscode);
    } else {
      this.setupIntellijCommunication();
    }

    this.postMessageToIde({
      payloadType: 'output-init',
    });
  }

  hostConnected(): void {
    // noop
  }

  postMessageToIde(message: GenerateUiOutputMessage) {
    console.log('sending message to ide', message);
    this.postToIde(message);
  }

  private pendingPluginValidationQueue: ((
    results: ValidationResults
  ) => void)[] = [];

  async getValidationResults(
    formValues: FormValues,
    schema: GeneratorSchema
  ): Promise<ValidationResults> {
    // send request and wait until handleInputMessage resolves the promise
    const promise = new Promise<ValidationResults>((resolve) => {
      this.pendingPluginValidationQueue.push(resolve);
    });

    this.postMessageToIde(
      new GenerateUiRequestValidationOutputMessage({ formValues, schema })
    );

    return await promise;
  }

  private setupVscodeCommunication(vscode: WebviewApi<undefined>) {
    window.addEventListener(
      'message',
      (event: MessageEvent<GenerateUiInputMessage>) => {
        const data = event.data;
        if (!data) {
          return;
        }
        console.log('received message from vscode', data);

        this.handleInputMessage(data);
      }
    );

    this.postToIde = (message) => vscode.postMessage(message);
  }

  private setupIntellijCommunication() {
    window.intellijApi?.registerPostToWebviewCallback(
      (message: GenerateUiInputMessage) => {
        if (message.payloadType === 'styles') {
          this.setIntellijStyles(message.payload);
          return;
        }

        this.handleInputMessage(message);
      }
    );

    this.postToIde = (message) => {
      const stringified = JSON.stringify(message);
      window.intellijApi?.postToIde(stringified);
    };
  }

  private handleInputMessage(message: GenerateUiInputMessage) {
    // TODO: Allow the UI to support array properties
    const optionFilter = (option: Option) =>
      option['x-priority'] !== 'internal';

    switch (message.payloadType) {
      case 'generator': {
        const description = message.payload;
        const descriptionWithFilteredOptions = {
          ...description,
          options: description.options.filter(optionFilter),
        };
        this.generatorSchema = descriptionWithFilteredOptions;
        this.host.requestUpdate();
        break;
      }

      case 'config': {
        this.configuration = message.payload;
        this.host.requestUpdate();
        break;
      }

      case 'banner': {
        this.banner = message.payload;
        this.host.requestUpdate();
        break;
      }

      case 'validation-results': {
        // get most recent listener from queue and resolve it
        if (this.pendingPluginValidationQueue.length > 0) {
          const resolve = this.pendingPluginValidationQueue.shift();
          if (!resolve) {
            break;
          }
          resolve(message.payload);
        }

        break;
      }
    }
  }

  private setIntellijStyles(styles: GenerateUiStyles) {
    const styleSheet = new CSSStyleSheet();
    styleSheet.replaceSync(`
    :root {
      --foreground-color: ${styles.foregroundColor};
      --background-color: ${styles.backgroundColor};
      --primary-color: ${styles.primaryColor};
      --field-background-color: ${styles.fieldBackgroundColor};
      --field-border-color: ${styles.fieldBorderColor};
      --select-field-background-color: ${styles.selectFieldBackgroundColor};
      --focus-border-color: ${styles.focusBorderColor};
      --banner-warning-color: ${styles.bannerWarningBackgroundColor};
      --badge-background-color: ${styles.badgeBackgroundColor};
    }
    `);
    // --secondary-text-color: ${styles.secondaryTextColor};
    // --text-input-background-color: ${styles.fieldBackground};
    // --text-input-border-color: ${styles.secondaryTextColor};
    // --checkbox-background-color: ${styles.fieldBackground};
    // --checkbox-border-color: ${styles.secondaryTextColor};
    // --dropdown-input-background-color: ${styles.fieldBackground};
    // --dropdown-input-border-color: ${styles.secondaryTextColor};
    // --font-family: ${styles.fontFamily};
    // --font-size: ${styles.fontSize};
    // --button-secondary-color: ${styles.fieldBackground};
    // --button-secondary-text-color: ${styles.secondaryTextColor};
    document.adoptedStyleSheets = [styleSheet];
  }
}
