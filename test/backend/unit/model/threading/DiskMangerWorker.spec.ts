import {expect} from 'chai';
import {DiskMangerWorker} from '../../../../../src/backend/model/threading/DiskMangerWorker';
import * as path from 'path';
import {Config} from '../../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {Utils} from '../../../../../src/common/Utils';

describe('DiskMangerWorker', () => {

  it('should parse metadata', async () => {
    Config.Server.Media.folder = path.join(__dirname, '/../../../assets');
    ProjectPath.ImageFolder = path.join(__dirname, '/../../../assets');
    const dir = await DiskMangerWorker.scanDirectory('/');
    // should match the number of media (photo/video) files in the assets folder
    expect(dir.media.length).to.be.equals(8);
    const expected = require(path.join(__dirname, '/../../../assets/test image öüóőúéáű-.,.json'));
    const i = dir.media.findIndex(m => m.name === 'test image öüóőúéáű-.,.jpg');
    expect(Utils.clone(dir.media[i].name)).to.be.deep.equal('test image öüóőúéáű-.,.jpg');
    expect(Utils.clone(dir.media[i].metadata)).to.be.deep.equal(expected);
  });

});
