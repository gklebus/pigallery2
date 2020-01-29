import {IPrivateConfig, ServerConfig} from './PrivateConfig';
import {ClientConfig} from '../public/ClientConfig';
import * as crypto from 'crypto';
import * as path from 'path';
import {ConfigClass} from 'typeconfig/src/decorators/class/ConfigClass';
import {ConfigProperty} from 'typeconfig/src/decorators/property/ConfigPropoerty';
import {IConfigClass} from 'typeconfig/src/decorators/class/IConfigClass';
import {ConfigClassBuilder} from 'typeconfig/src/decorators/builders/ConfigClassBuilder';


@ConfigClass({
  configPath: path.join(__dirname, './../../../../config.json'),
  saveIfNotExist: true,
  attachDescription: true,
  enumsAsString: true,
  cli: {
    enable: {
      configPath: true,
      attachDefaults: true,
      attachDescription: true,
      rewriteCLIConfig: true,
      rewriteENVConfig: true,
      enumsAsString: true,
      saveIfNotExist: true,
      exitOnConfig: true
    },
    defaults: {
      enabled: true
    }
  }
})
export class PrivateConfigClass implements IPrivateConfig {
  @ConfigProperty()
  Server: ServerConfig.Config = new ServerConfig.Config();
  @ConfigProperty()
  Client: ClientConfig.Config = new ClientConfig.Config();

  constructor() {
    if (!this.Server.sessionSecret || this.Server.sessionSecret.length === 0) {
      this.Server.sessionSecret = [crypto.randomBytes(256).toString('hex'),
        crypto.randomBytes(256).toString('hex'),
        crypto.randomBytes(256).toString('hex')];
    }
  }

  async original(): Promise<PrivateConfigClass & IConfigClass> {
    const pc = ConfigClassBuilder.attachInterface(new PrivateConfigClass());
    await pc.load();
    return pc;
  }

}

export const Config = ConfigClassBuilder.attachInterface(new PrivateConfigClass());
Config.loadSync();
