
import User from "../user";
import { doAddDataExportTask } from "../utils/common";
import Config from "../config";
import fail from "../utils/fail";
import AWS from "aws-sdk";

AWS.config.update({ region: Config.awsRegion });
const s3Client = new AWS.S3({ apiVersion: "2006-03-01" });

function handle_GET_dataExport(
    req: { p: { uid?: any; zid: any; unixTimestamp: number; format: any } },
    res: { json: (arg0: {}) => void }
  ) {
    const getUserInfoForUid2 = User.getUserInfoForUid2;
    getUserInfoForUid2(req.p.uid)
      .then((user: { email: any }) => {
        return doAddDataExportTask(
          Config.mathEnv,
          user.email,
          req.p.zid,
          req.p.unixTimestamp * 1000,
          req.p.format,
          Math.abs((Math.random() * 999999999999) >> 0)
        )
          .then(() => {
            res.json({});
          })
          .catch((err: any) => {
            fail(res, 500, "polis_err_data_export123", err);
          });
      })
      .catch((err: any) => {
        fail(res, 500, "polis_err_data_export123b", err);
      });
  }

  function handle_GET_dataExport_results(
      req: { p: { filename: string } },
      res: { redirect: (arg0: any) => void }
    ) {
      var url = s3Client.getSignedUrl("getObject", {
        Bucket: "polis-datadump",
        Key: Config.mathEnv + "/" + req.p.filename,
        Expires: 60 * 60 * 24 * 7,
      });
      res.redirect(url);
    }

  export { handle_GET_dataExport, handle_GET_dataExport_results }